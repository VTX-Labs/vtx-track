/**
 * vtx-track VS Code extension — IDE context enrichment.
 *
 * This extension does NOT track time. The vtx-track daemon owns the single
 * timeline and already sees the VS Code window as the foreground app (by pid).
 * Our only job is to PUSH a lightweight `VsCodeContext` describing what the user
 * is doing — workspace, repo, branch, file, language, mode, and whether they are
 * actively typing — so the daemon can attach it to the segment it is already
 * timing. We keep no clock, queue nothing, and degrade silently when the daemon
 * is offline. See DESIGN.md sections 5 and 9.
 */

import * as vscode from "vscode";
import type { VsCodeContext } from "@vtx-track/protocol";
import { ContextClient } from "./client.js";
import { deriveMode, isTestFile, relativeFilePath, type WindowState } from "./derive.js";

/** How long after a keystroke the window is considered "actively typing". */
const TYPING_WINDOW_MS = 2000;
/** Debounce window before a context change is pushed. */
const PUSH_DEBOUNCE_MS = 250;
/** Periodic re-push interval while focused (keeps the daemon's freshness alive). */
const HEARTBEAT_MS = 10_000;
/** How often to refresh the status-bar label from the daemon. */
const STATUS_REFRESH_MS = 30_000;

/** Mutable state captured from VS Code events, fed into the pure helpers. */
interface ExtensionState {
  context: vscode.ExtensionContext;
  client: ContextClient;
  status: vscode.StatusBarItem;
  pid: number;
  /** Timestamp (ms) of the last text edit, for the typing window. */
  lastEditAt: number;
  /** True when a debug session is currently running. */
  debugging: boolean;
  /** True when a terminal is the active panel. */
  terminalActive: boolean;
  /** True while the VS Code window is focused. */
  focused: boolean;
  /** JSON of the last successfully-built context, to send only deltas. */
  lastSentKey: string | undefined;
  /** Whether file paths may be sent (privacy setting). */
  sendFilePaths: boolean;
  /** Whether enrichment is enabled at all. */
  enabled: boolean;
  /** Debounce + heartbeat timers. */
  debounceTimer: ReturnType<typeof setTimeout> | undefined;
  heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  statusTimer: ReturnType<typeof setInterval> | undefined;
}

let state: ExtensionState | undefined;

/** Entry point: VS Code calls this on `onStartupFinished`. */
export function activate(context: vscode.ExtensionContext): void {
  const cfg = readConfig();
  const status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  status.text = "$(watch) vtx-track";
  status.tooltip = "vtx-track — open dashboard";
  status.command = "vtx-track.openDashboard";

  state = {
    context,
    client: new ContextClient({ baseUrl: cfg.daemonUrl }),
    status,
    pid: process.pid,
    lastEditAt: 0,
    debugging: false,
    terminalActive: false,
    focused: vscode.window.state.focused,
    lastSentKey: undefined,
    sendFilePaths: cfg.sendFilePaths,
    enabled: cfg.enabled,
    debounceTimer: undefined,
    heartbeatTimer: undefined,
    statusTimer: undefined,
  };

  context.subscriptions.push(
    status,
    vscode.commands.registerCommand("vtx-track.openDashboard", openDashboard),
    vscode.window.onDidChangeActiveTextEditor(() => schedulePush()),
    vscode.workspace.onDidChangeTextDocument((e) => onTextChanged(e)),
    vscode.window.onDidChangeWindowState((s) => onWindowState(s)),
    vscode.window.onDidChangeActiveTerminal((t) => onActiveTerminal(t)),
    vscode.debug.onDidStartDebugSession(() => onDebug(true)),
    vscode.debug.onDidTerminateDebugSession(() => onDebug(false)),
    vscode.workspace.onDidChangeConfiguration((e) => onConfigChanged(e)),
    { dispose: stopTimers },
  );

  if (state.enabled && state.focused) {
    startHeartbeat();
  }
  startStatusRefresh();
  void refreshStatus();
  schedulePush();
}

/** Entry point: VS Code calls this on shutdown / disable. */
export function deactivate(): void {
  stopTimers();
  state = undefined;
}

// ── event handlers ───────────────────────────────────────────────────────

function onTextChanged(e: vscode.TextDocumentChangeEvent): void {
  if (!state || e.contentChanges.length === 0) return;
  const active = vscode.window.activeTextEditor;
  // Only count edits to the focused document as "actively typing".
  if (active && e.document === active.document) {
    state.lastEditAt = Date.now();
    schedulePush();
  }
}

function onWindowState(winState: vscode.WindowState): void {
  if (!state) return;
  const wasFocused = state.focused;
  state.focused = winState.focused;
  if (winState.focused && !wasFocused) {
    // Regained focus: resume pushing context so the daemon stays enriched.
    if (state.enabled) startHeartbeat();
    schedulePush();
  } else if (!winState.focused && wasFocused) {
    // Lost focus: the OS-level app takes over. Stop pushing — no shadow clock.
    stopHeartbeat();
    state.lastSentKey = undefined;
  }
}

function onActiveTerminal(terminal: vscode.Terminal | undefined): void {
  if (!state) return;
  state.terminalActive = terminal !== undefined;
  schedulePush();
}

function onDebug(active: boolean): void {
  if (!state) return;
  // A session may start while another is ending; trust the live session count.
  state.debugging = active || vscode.debug.activeDebugSession !== undefined;
  schedulePush();
}

function onConfigChanged(e: vscode.ConfigurationChangeEvent): void {
  if (!state || !e.affectsConfiguration("vtx-track")) return;
  const cfg = readConfig();
  state.client.setBaseUrl(cfg.daemonUrl);
  state.sendFilePaths = cfg.sendFilePaths;
  const wasEnabled = state.enabled;
  state.enabled = cfg.enabled;
  if (state.enabled && !wasEnabled) {
    if (state.focused) startHeartbeat();
    schedulePush();
  } else if (!state.enabled && wasEnabled) {
    stopHeartbeat();
    state.lastSentKey = undefined;
    setStatus("$(watch) vtx-track: off");
  }
}

function openDashboard(): void {
  const url = state?.client.dashboardUrl() ?? "http://127.0.0.1:7842/";
  void vscode.env.openExternal(vscode.Uri.parse(url));
}

// ── push pipeline ──────────────────────────────────────────────────────────

/** Debounced trigger for a context push. */
function schedulePush(): void {
  if (!state || !state.enabled) return;
  if (state.debounceTimer) clearTimeout(state.debounceTimer);
  state.debounceTimer = setTimeout(() => {
    if (state) state.debounceTimer = undefined;
    void pushNow();
  }, PUSH_DEBOUNCE_MS);
}

/** Build the current context and push it if it differs from the last send. */
async function pushNow(): Promise<void> {
  if (!state || !state.enabled || !state.focused) return;
  const ctx = buildContext(state);
  const key = JSON.stringify(ctx);
  if (key === state.lastSentKey) return;

  const result = await state.client.pushContext(ctx);
  if (result === "ok") {
    state.lastSentKey = key;
    void refreshStatus();
  } else if (result === "offline") {
    state.lastSentKey = undefined;
    setStatus("$(watch) vtx-track: daemon offline");
  }
}

/** Assemble a {@link VsCodeContext} from the live VS Code API + helpers. */
function buildContext(s: ExtensionState): VsCodeContext {
  const editor = vscode.window.activeTextEditor;
  const doc = editor?.document;
  const filePath = doc?.uri.fsPath;

  const workspaceFolder = resolveWorkspaceFolder(doc);
  const workspaceRoot = workspaceFolder?.uri.fsPath;

  const fileIsTest = filePath ? isTestFile(filePath) : false;
  const windowState: WindowState = {
    debugging: s.debugging,
    terminalActive: s.terminalActive,
    hasActiveEditor: editor !== undefined,
    isTestFile: fileIsTest,
    activelyTyping: Date.now() - s.lastEditAt < TYPING_WINDOW_MS,
  };

  const ctx: VsCodeContext = {
    pid: s.pid,
    mode: deriveMode(windowState),
    activelyTyping: windowState.activelyTyping,
  };

  const workspaceName = workspaceFolder?.name;
  if (workspaceName) ctx.workspace = workspaceName;

  if (filePath && s.sendFilePaths) {
    ctx.filePath = relativeFilePath(workspaceRoot, filePath);
  }
  if (doc?.languageId) ctx.language = doc.languageId;

  const git = resolveGit(filePath, workspaceRoot);
  if (git.repo) ctx.repo = git.repo;
  if (git.branch) ctx.branch = git.branch;

  return ctx;
}

/**
 * Pick the workspace folder for the active document, falling back to the first
 * folder of a multi-root workspace. Guards an absent workspace.
 */
function resolveWorkspaceFolder(
  doc: vscode.TextDocument | undefined,
): vscode.WorkspaceFolder | undefined {
  if (doc) {
    const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
    if (folder) return folder;
  }
  return vscode.workspace.workspaceFolders?.[0];
}

/**
 * Resolve git repo name + branch via the built-in `vscode.git` extension API.
 * Every access is guarded — the git extension may be missing, disabled, or
 * still activating, and its API surface is loosely typed.
 */
function resolveGit(
  filePath: string | undefined,
  workspaceRoot: string | undefined,
): { repo?: string; branch?: string } {
  try {
    const ext = vscode.extensions.getExtension<GitExtensionExports>("vscode.git");
    const api = ext?.isActive ? ext.exports?.getAPI?.(1) : undefined;
    const repos = api?.repositories;
    if (!repos || repos.length === 0) return {};

    const repo = pickRepository(repos, filePath, workspaceRoot);
    if (!repo) return {};

    const out: { repo?: string; branch?: string } = {};
    const branch = repo.state?.HEAD?.name;
    if (branch) out.branch = branch;

    const name = repoName(repo);
    if (name) out.repo = name;
    return out;
  } catch {
    // The git API is best-effort; never let it break enrichment.
    return {};
  }
}

/** Choose the repository whose root best contains the active file/workspace. */
function pickRepository(
  repos: GitRepository[],
  filePath: string | undefined,
  workspaceRoot: string | undefined,
): GitRepository | undefined {
  const target = (filePath ?? workspaceRoot)?.replace(/\\/g, "/").toLowerCase();
  if (target) {
    let best: GitRepository | undefined;
    let bestLen = -1;
    for (const r of repos) {
      const root = r.rootUri?.fsPath?.replace(/\\/g, "/").toLowerCase();
      if (root && target.startsWith(root) && root.length > bestLen) {
        best = r;
        bestLen = root.length;
      }
    }
    if (best) return best;
  }
  return repos[0];
}

/** Derive a repo name: prefer the origin remote, else the root folder name. */
function repoName(repo: GitRepository): string | undefined {
  const remotes = repo.state?.remotes ?? [];
  const origin = remotes.find((r) => r.name === "origin") ?? remotes[0];
  const url = origin?.fetchUrl ?? origin?.pushUrl;
  if (url) {
    const cleaned = url
      .replace(/\.git$/, "")
      .replace(/\/$/, "");
    const slash = cleaned.lastIndexOf("/");
    const colon = cleaned.lastIndexOf(":");
    const cut = Math.max(slash, colon);
    const name = cut === -1 ? cleaned : cleaned.slice(cut + 1);
    if (name) return name;
  }
  const root = repo.rootUri?.fsPath;
  if (!root) return undefined;
  const norm = root.replace(/\\/g, "/").replace(/\/$/, "");
  const idx = norm.lastIndexOf("/");
  return idx === -1 ? norm : norm.slice(idx + 1);
}

// ── status bar ───────────────────────────────────────────────────────────

/** Refresh the status-bar label from the daemon (health + today's total). */
async function refreshStatus(): Promise<void> {
  if (!state) return;
  if (!state.enabled) {
    setStatus("$(watch) vtx-track: off");
    return;
  }
  const health = await state.client.health();
  if (!health) {
    setStatus("$(watch) vtx-track: daemon offline");
    return;
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const summary = await state.client.summary(startOfDay.getTime(), Date.now());
  if (summary) {
    setStatus(`$(watch) vtx-track ${formatDuration(summary.totalMs)}`);
  } else {
    setStatus("$(watch) vtx-track tracking");
  }
}

function setStatus(text: string): void {
  if (state) state.status.text = text;
}

/** Render a duration in compact `Hh Mm` / `Mm` form. */
function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// ── timers ─────────────────────────────────────────────────────────────────

function startHeartbeat(): void {
  if (!state || state.heartbeatTimer) return;
  state.heartbeatTimer = setInterval(() => {
    // Re-push so a context that hasn't changed still refreshes the daemon's
    // freshness window. Force a resend by clearing the dedupe key first.
    if (state) state.lastSentKey = undefined;
    void pushNow();
  }, HEARTBEAT_MS);
}

function stopHeartbeat(): void {
  if (state?.heartbeatTimer) {
    clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = undefined;
  }
}

function startStatusRefresh(): void {
  if (!state || state.statusTimer) return;
  state.statusTimer = setInterval(() => {
    if (state?.focused) void refreshStatus();
  }, STATUS_REFRESH_MS);
}

function stopTimers(): void {
  if (!state) return;
  if (state.debounceTimer) clearTimeout(state.debounceTimer);
  stopHeartbeat();
  if (state.statusTimer) clearInterval(state.statusTimer);
  state.debounceTimer = undefined;
  state.statusTimer = undefined;
}

// ── config ─────────────────────────────────────────────────────────────────

interface ResolvedConfig {
  daemonUrl: string;
  enabled: boolean;
  sendFilePaths: boolean;
}

function readConfig(): ResolvedConfig {
  const cfg = vscode.workspace.getConfiguration("vtx-track");
  return {
    daemonUrl: cfg.get<string>("daemonUrl") ?? "http://127.0.0.1:7842",
    enabled: cfg.get<boolean>("enabled") ?? true,
    sendFilePaths: cfg.get<boolean>("sendFilePaths") ?? true,
  };
}

// ── minimal typings for the built-in git extension API ──────────────────────
// The `vscode.git` extension is not part of `@types/vscode`; we model only the
// fields we read. Everything is optional and accessed defensively.

interface GitExtensionExports {
  getAPI?(version: 1): GitApi | undefined;
}

interface GitApi {
  repositories?: GitRepository[];
}

interface GitRepository {
  rootUri?: { fsPath?: string };
  state?: {
    HEAD?: { name?: string };
    remotes?: GitRemote[];
  };
}

interface GitRemote {
  name?: string;
  fetchUrl?: string;
  pushUrl?: string;
}
