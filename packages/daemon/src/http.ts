import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Config, GroupBy } from "@vtx-track/protocol";
import {
  focusMetrics,
  fromDateString,
  dayRange,
  saveConfig,
  standup,
  summarize,
  timesheet,
} from "@vtx-track/core";
import type { Tracker } from "./tracker.js";
import { VERSION } from "./version.js";

export interface HttpDeps {
  tracker: Tracker;
  token: string;
  getConfig: () => Config;
  setConfig: (patch: Partial<Config>) => Config;
  wipe: () => number;
  startedAt: number;
  capabilities: { platform: string; windowIdentificationLimited: boolean };
  /** Optional static dashboard handler; called for non-API routes. */
  serveStatic?: (req: IncomingMessage, res: ServerResponse) => boolean;
}

const GROUP_BYS = new Set<GroupBy>([
  "app",
  "category",
  "project",
  "language",
  "branch",
]);

/**
 * The localhost HTTP API. Binds to 127.0.0.1 only. Read endpoints are open on
 * localhost; control/config endpoints require the bearer token.
 */
export function createHttpServer(deps: HttpDeps): Server {
  return createServer((req, res) => {
    handle(req, res, deps).catch((err) => {
      sendJson(res, 500, { error: String(err?.message ?? err) });
    });
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HttpDeps,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const path = url.pathname;
  const method = req.method ?? "GET";

  // CORS for the local dashboard / browser extension (localhost only).
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── Read endpoints (no token) ──────────────────────────────────────────
  if (path === "/health") {
    sendJson(res, 200, {
      ok: true,
      version: VERSION,
      uptimeMs: Date.now() - deps.startedAt,
      tracking: !deps.tracker.isPaused(),
      paused: deps.tracker.isPaused(),
      platform: deps.capabilities.platform,
      windowIdentificationLimited:
        deps.capabilities.windowIdentificationLimited,
    });
    return;
  }

  if (path === "/report/summary" && method === "GET") {
    const { from, to } = range(url);
    const by = groupBy(url);
    sendJson(res, 200, summarize(deps.tracker.segmentsBetween(from, to), from, to, by));
    return;
  }

  if (path === "/report/timeline" && method === "GET") {
    const { from, to } = range(url);
    sendJson(res, 200, deps.tracker.segmentsBetween(from, to));
    return;
  }

  if (path === "/report/focus" && method === "GET") {
    const date = url.searchParams.get("date") ?? today();
    const { from, to } = dayRange(fromDateString(date));
    sendJson(res, 200, focusMetrics(deps.tracker.segmentsBetween(from, to), date));
    return;
  }

  if (path === "/report/standup" && method === "GET") {
    const date = url.searchParams.get("date") ?? today();
    const { from, to } = dayRange(fromDateString(date));
    sendJson(res, 200, standup(deps.tracker.segmentsBetween(from, to), date));
    return;
  }

  if (path === "/report/timesheet" && method === "GET") {
    const { from, to } = range(url);
    const by = groupBy(url);
    sendJson(res, 200, timesheet(deps.tracker.segmentsBetween(from, to), from, to, by));
    return;
  }

  if (path === "/config" && method === "GET") {
    sendJson(res, 200, deps.getConfig());
    return;
  }

  // The set of app names that have a real icon cached, so the dashboard can
  // request only what exists and fall back to a generated badge otherwise.
  if (path === "/icons" && method === "GET") {
    sendJson(res, 200, { apps: deps.tracker.appsWithIcons() });
    return;
  }

  // A single app's real icon as a PNG. `?app=<name>` — names match the "By app"
  // summary keys. 404 (not error) when we have no icon, so the dashboard quietly
  // falls back. Cached aggressively: an app's icon doesn't change within a run.
  if (path === "/icon" && method === "GET") {
    const app = url.searchParams.get("app") ?? "";
    const dataUri = app ? deps.tracker.iconFor(app) : undefined;
    const png = dataUri ? decodePngDataUri(dataUri) : null;
    if (!png) {
      sendJson(res, 404, { error: "no icon" });
      return;
    }
    res.writeHead(200, {
      "content-type": "image/png",
      "content-length": png.length,
      "cache-control": "public, max-age=86400",
    });
    res.end(png);
    return;
  }

  // ── Context push (from VS Code / browser extensions) ───────────────────
  if (path === "/context/vscode" && method === "POST") {
    const body = await readBody(req);
    if (body && typeof body === "object" && "pid" in body) {
      deps.tracker.setVsCodeContext(body as never);
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (path === "/context/browser" && method === "POST") {
    const body = await readBody(req);
    if (body && typeof body === "object" && "pid" in body) {
      deps.tracker.setBrowserContext(body as never);
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  // ── Control endpoints (token required) ─────────────────────────────────
  const controlPaths = ["/control/pause", "/control/resume", "/control/wipe"];
  if (controlPaths.includes(path) || (path === "/config" && method === "PUT")) {
    if (!authorized(req, deps.token)) {
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }
    if (path === "/control/pause") {
      deps.tracker.pause();
      sendJson(res, 200, healthSnapshot(deps));
      return;
    }
    if (path === "/control/resume") {
      deps.tracker.resume();
      sendJson(res, 200, healthSnapshot(deps));
      return;
    }
    if (path === "/control/wipe") {
      const body = await readBody(req);
      if (!body || (body as { confirm?: unknown }).confirm !== true) {
        sendJson(res, 400, { error: "confirmation required" });
        return;
      }
      sendJson(res, 200, { deleted: deps.wipe() });
      return;
    }
    if (path === "/config" && method === "PUT") {
      const patch = (await readBody(req)) as Partial<Config> | null;
      const merged = deps.setConfig(patch ?? {});
      saveConfig(merged);
      sendJson(res, 200, merged);
      return;
    }
  }

  // ── Static dashboard (if mounted) ──────────────────────────────────────
  if (deps.serveStatic && method === "GET" && deps.serveStatic(req, res)) {
    return;
  }

  sendJson(res, 404, { error: "not found" });
}

function healthSnapshot(deps: HttpDeps) {
  return {
    ok: true,
    version: VERSION,
    uptimeMs: Date.now() - deps.startedAt,
    tracking: !deps.tracker.isPaused(),
    paused: deps.tracker.isPaused(),
    platform: deps.capabilities.platform,
    windowIdentificationLimited: deps.capabilities.windowIdentificationLimited,
  };
}

function authorized(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization ?? "";
  return header === `Bearer ${token}`;
}

function range(url: URL): { from: number; to: number } {
  const now = Date.now();
  const from = Number(url.searchParams.get("from")) || dayRange(now).from;
  const to = Number(url.searchParams.get("to")) || now;
  return { from, to };
}

function groupBy(url: URL): GroupBy {
  const by = url.searchParams.get("by") as GroupBy | null;
  return by && GROUP_BYS.has(by) ? by : "app";
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/**
 * Decode a `data:image/png;base64,…` URI into a PNG Buffer, or null if it isn't
 * a base64 PNG data URI. The platform layer supplies icons in exactly this form.
 */
function decodePngDataUri(uri: string): Buffer | null {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(uri);
  if (!m || !m[1]) return null;
  try {
    return Buffer.from(m[1], "base64");
  } catch {
    return null;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(json);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}
