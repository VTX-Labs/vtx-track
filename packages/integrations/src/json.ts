import type {
  ActivityState,
  BrowserContext,
  Segment,
  VsCodeContext,
  VsCodeMode,
} from "@vtx-track/protocol";

const ACTIVITY_STATES: ReadonlySet<string> = new Set([
  "active",
  "idlePrevented",
  "idle",
  "locked",
  "private",
  "unknown",
]);

const VSCODE_MODES: ReadonlySet<string> = new Set([
  "edit",
  "view",
  "debug",
  "test",
  "terminal",
]);

/**
 * Serialize segments to a stable, pretty-printed JSON document. The inverse of
 * `fromJson`.
 */
export function toJson(segments: Segment[]): string {
  return JSON.stringify(segments, null, 2);
}

/** Thrown when `fromJson` is given input that is not a valid Segment array. */
export class MalformedSegmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedSegmentError";
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function reqString(o: Record<string, unknown>, key: string, at: string): string {
  const v = o[key];
  if (typeof v !== "string") {
    throw new MalformedSegmentError(`${at}: "${key}" must be a string`);
  }
  return v;
}

function reqNumber(o: Record<string, unknown>, key: string, at: string): number {
  const v = o[key];
  if (typeof v !== "number" || Number.isNaN(v)) {
    throw new MalformedSegmentError(`${at}: "${key}" must be a number`);
  }
  return v;
}

function optString(
  o: Record<string, unknown>,
  key: string,
  at: string,
): string | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (typeof v !== "string") {
    throw new MalformedSegmentError(`${at}: "${key}" must be a string when present`);
  }
  return v;
}

function parseVsCode(v: unknown, at: string): VsCodeContext {
  if (!isObject(v)) {
    throw new MalformedSegmentError(`${at}: "vscode" must be an object`);
  }
  const mode = reqString(v, "mode", `${at}.vscode`);
  if (!VSCODE_MODES.has(mode)) {
    throw new MalformedSegmentError(`${at}.vscode: invalid mode "${mode}"`);
  }
  const typing = v["activelyTyping"];
  if (typeof typing !== "boolean") {
    throw new MalformedSegmentError(`${at}.vscode: "activelyTyping" must be boolean`);
  }
  const ctx: VsCodeContext = {
    pid: reqNumber(v, "pid", `${at}.vscode`),
    mode: mode as VsCodeMode,
    activelyTyping: typing,
  };
  const workspace = optString(v, "workspace", `${at}.vscode`);
  if (workspace !== undefined) ctx.workspace = workspace;
  const repo = optString(v, "repo", `${at}.vscode`);
  if (repo !== undefined) ctx.repo = repo;
  const branch = optString(v, "branch", `${at}.vscode`);
  if (branch !== undefined) ctx.branch = branch;
  const filePath = optString(v, "filePath", `${at}.vscode`);
  if (filePath !== undefined) ctx.filePath = filePath;
  const language = optString(v, "language", `${at}.vscode`);
  if (language !== undefined) ctx.language = language;
  return ctx;
}

function parseBrowser(v: unknown, at: string): BrowserContext {
  if (!isObject(v)) {
    throw new MalformedSegmentError(`${at}: "browser" must be an object`);
  }
  const ctx: BrowserContext = {
    pid: reqNumber(v, "pid", `${at}.browser`),
    domain: reqString(v, "domain", `${at}.browser`),
  };
  const tabTitle = optString(v, "tabTitle", `${at}.browser`);
  if (tabTitle !== undefined) ctx.tabTitle = tabTitle;
  return ctx;
}

function parseSegment(v: unknown, index: number): Segment {
  const at = `segment[${index}]`;
  if (!isObject(v)) {
    throw new MalformedSegmentError(`${at}: must be an object`);
  }
  const state = reqString(v, "state", at);
  if (!ACTIVITY_STATES.has(state)) {
    throw new MalformedSegmentError(`${at}: invalid state "${state}"`);
  }
  const title = v["title"];
  if (title !== null && typeof title !== "string") {
    throw new MalformedSegmentError(`${at}: "title" must be a string or null`);
  }
  const seg: Segment = {
    id: reqNumber(v, "id", at),
    app: reqString(v, "app", at),
    appExePath: reqString(v, "appExePath", at),
    category: reqString(v, "category", at),
    title,
    startedAt: reqNumber(v, "startedAt", at),
    endedAt: reqNumber(v, "endedAt", at),
    durationMs: reqNumber(v, "durationMs", at),
    state: state as ActivityState,
    host: reqString(v, "host", at),
  };
  if (v["vscode"] !== undefined) seg.vscode = parseVsCode(v["vscode"], at);
  if (v["browser"] !== undefined) seg.browser = parseBrowser(v["browser"], at);
  return seg;
}

/**
 * Parse and validate a JSON document into a `Segment[]`. Throws
 * `MalformedSegmentError` if the JSON is invalid or does not match the Segment
 * shape. The inverse of `toJson`.
 */
export function fromJson(text: string): Segment[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new MalformedSegmentError(
      `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new MalformedSegmentError("expected a top-level array of segments");
  }
  return parsed.map((v, i) => parseSegment(v, i));
}
