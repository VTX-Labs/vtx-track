/**
 * Shared domain and wire types for vtx-track.
 *
 * Every surface (daemon, CLI, VS Code extension, dashboard, integrations) speaks
 * these types. They are intentionally dependency-free so the package can be
 * imported anywhere, including the browser dashboard.
 */

/** Default port for the daemon's localhost HTTP API. */
export const DEFAULT_HTTP_PORT = 7842;

/** Default idle threshold (seconds) before the active app stops accruing time. */
export const DEFAULT_IDLE_THRESHOLD_SECONDS = 120;

/** Default heartbeat interval (milliseconds) for duration/idle updates. */
export const DEFAULT_HEARTBEAT_MS = 5000;

/**
 * Activity state of a segment, mirroring `@paymoapp/real-idle`'s IdleState plus
 * a `private` value for redacted spans.
 *
 * - `active`        — user actively using the system.
 * - `idlePrevented` — no input, but something blocks idle (video, meeting). Counts.
 * - `idle`          — no input past the threshold. Does not accrue to an app.
 * - `locked`        — the session is locked.
 * - `private`       — tracking was paused or the app/site is on the denylist.
 * - `unknown`       — the platform could not determine state (e.g. Wayland).
 */
export type ActivityState =
  | "active"
  | "idlePrevented"
  | "idle"
  | "locked"
  | "private"
  | "unknown";

/** How a VS Code window was being used when a segment was recorded. */
export type VsCodeMode = "edit" | "view" | "debug" | "test" | "terminal";

/** A raw active-window observation from the platform layer. */
export interface WindowSample {
  /** Application/process name, e.g. "Code", "chrome", "Slack". */
  app: string;
  /** Window title (pre-redaction). Empty string when unavailable. */
  title: string;
  /** Absolute path to the executable. Empty string when unavailable. */
  exePath: string;
  /** OS process id, or -1 when unavailable. */
  pid: number;
  /**
   * The app's icon as a `data:image/png;base64,…` URI, when the platform layer
   * can read it (Windows/macOS via the native addon). Undefined otherwise. Not
   * persisted to the timeline — the daemon caches it by app name to serve to the
   * dashboard.
   */
  icon?: string;
}

/** Idle reading from the platform layer at a moment in time. */
export interface IdleReading {
  /** Resolved activity state. */
  state: ActivityState;
  /** Seconds since last input, or -1 if the platform couldn't read it. */
  idleSeconds: number;
  /** True if the screen is locked (where detectable). */
  locked: boolean;
}

/**
 * IDE context pushed by the VS Code extension. The daemon attaches the latest
 * context for a given pid to whatever segment it is already timing — the
 * extension never keeps its own clock.
 */
export interface VsCodeContext {
  /** PID of the VS Code window's process, used to match the daemon's app view. */
  pid: number;
  /** Active workspace folder name, if any. */
  workspace?: string;
  /** Git repository name or remote, if resolvable. */
  repo?: string;
  /** Current git branch, if resolvable. */
  branch?: string;
  /** Active file path, relative to the workspace folder (redactable). */
  filePath?: string;
  /** VS Code languageId of the active editor, e.g. "typescript". */
  language?: string;
  /** What the user is doing in the window. */
  mode: VsCodeMode;
  /** True if the user typed within the active-edit window (~2s). */
  activelyTyping: boolean;
}

/** Tab context pushed by the browser extension (domain-only by default). */
export interface BrowserContext {
  /** PID of the browser process the tab belongs to. */
  pid: number;
  /** Registrable domain, e.g. "github.com". Never the full URL by default. */
  domain: string;
  /** Tab title (subject to the same redaction rules as window titles). */
  tabTitle?: string;
}

/** A resolved, persisted span of activity — the unit of the timeline. */
export interface Segment {
  id: number;
  app: string;
  appExePath: string;
  category: string;
  title: string | null;
  startedAt: number; // epoch ms
  endedAt: number; // epoch ms
  durationMs: number;
  state: ActivityState;
  host: string;
  vscode?: VsCodeContext;
  browser?: BrowserContext;
}

/** Categorization rule. Earlier rules win; user rules precede defaults. */
export interface CategoryRule {
  /** Category to assign when the rule matches. */
  category: string;
  /** Match exact app name (case-insensitive). */
  app?: string;
  /** Match the executable path against a glob, e.g. `**` + `/Code.exe`. */
  exeGlob?: string;
  /** Match the window title against a regular expression source. */
  titleRegex?: string;
  /** Match a browser domain (when browser context is present). */
  domain?: string;
}

/** Title redaction strategy. */
export type RedactionMode = "full" | "apps-only" | "patterns";

/** Default minimum segment duration (ms); shorter spans are dropped as flicker. */
export const DEFAULT_MIN_SEGMENT_MS = 1000;

/** User-tunable daemon configuration. */
export interface Config {
  httpPort: number;
  idleThresholdSeconds: number;
  heartbeatMs: number;
  /** Segments shorter than this (ms) are merged away as focus flicker. */
  minSegmentMs: number;
  /** App names or domains that must never be logged. */
  denylist: string[];
  redaction: RedactionMode;
  /** Regex sources applied when `redaction === "patterns"`. */
  redactionPatterns: string[];
  /** Category rules, highest priority first. Merged ahead of built-ins. */
  categoryRules: CategoryRule[];
  /** Per-day goals/limits in minutes, keyed by category. */
  goals: Record<string, GoalSpec>;
  /** Absolute path to the SQLite database. */
  dbPath: string;
}

/** A goal or limit for a category. */
export interface GoalSpec {
  /** Target minutes per day (a goal to reach). */
  targetMinutes?: number;
  /** Cap in minutes per day (a limit not to exceed). */
  limitMinutes?: number;
}

// ── Reporting shapes ───────────────────────────────────────────────────────

/** What to group a summary report by. */
export type GroupBy = "app" | "category" | "project" | "language" | "branch";

/** One row of a grouped summary. */
export interface SummaryRow {
  key: string;
  durationMs: number;
  /** Active-only duration (excludes idlePrevented), for productivity views. */
  activeMs: number;
  share: number; // 0..1 of the total in the window
}

export interface SummaryReport {
  from: number;
  to: number;
  groupBy: GroupBy;
  totalMs: number;
  rows: SummaryRow[];
}

/** Focus / context-switching metrics for a day. */
export interface FocusReport {
  date: string; // YYYY-MM-DD
  totalActiveMs: number;
  /** Number of times the foreground app changed. */
  contextSwitches: number;
  /** Switches per active hour — lower is more focused. */
  switchesPerHour: number;
  /** Longest uninterrupted active span on a single app/project, in ms. */
  longestDeepWorkMs: number;
  /** Count of deep-work spans ≥ 25 minutes. */
  deepWorkSessions: number;
}

/** A generated standup summary. */
export interface StandupReport {
  date: string;
  totalActiveMs: number;
  /** Markdown summary suitable for pasting into a standup channel. */
  markdown: string;
  /** Per-project highlights. */
  projects: Array<{ project: string; durationMs: number; branches: string[] }>;
}

/** A billable timesheet rollup. */
export interface TimesheetReport {
  from: number;
  to: number;
  groupBy: GroupBy;
  rows: Array<{ key: string; durationMs: number; hours: number }>;
  totalHours: number;
}

/** Daemon health/status. */
export interface HealthStatus {
  ok: boolean;
  version: string;
  uptimeMs: number;
  tracking: boolean;
  paused: boolean;
  platform: string;
  /** True when the platform can't identify the active window (e.g. Wayland). */
  windowIdentificationLimited: boolean;
}
