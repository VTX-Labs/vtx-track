/**
 * A tiny HTTP wrapper used by the extension to talk to the vtx-track daemon.
 *
 * Two jobs only: PUSH `VsCodeContext` enrichment, and READ health/summary for
 * the status bar. It never throws on a daemon-offline condition — every method
 * resolves to a sentinel ("offline" or `null`) so the extension can degrade
 * gracefully. The extension keeps NO clock; the daemon owns the timeline.
 *
 * Uses the global `fetch` available in the Node 20+ extension host. A custom
 * fetch can be injected for tests (kept out of the vscode-coupled paths).
 */

import type { HealthStatus, SummaryReport, VsCodeContext } from "@vtx-track/protocol";

/** Result of a context push, so callers can reflect daemon reachability. */
export type PushResult = "ok" | "offline" | "error";

/** Options for constructing a {@link ContextClient}. */
export interface ContextClientOptions {
  /** Base URL of the daemon HTTP API, e.g. `http://127.0.0.1:7842`. */
  baseUrl?: string;
  /** Custom fetch implementation (for tests). Defaults to global `fetch`. */
  fetch?: typeof fetch;
  /** Per-request timeout in milliseconds. Defaults to 1500ms. */
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = "http://127.0.0.1:7842";
const DEFAULT_TIMEOUT_MS = 1500;

/**
 * Minimal client for the daemon's localhost API, scoped to what the VS Code
 * extension needs. All methods are non-throwing.
 */
export class ContextClient {
  private baseUrl: string;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly timeoutMs: number;

  constructor(opts: ContextClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(opts.baseUrl ?? DEFAULT_BASE_URL);
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Point the client at a (possibly reconfigured) daemon URL. */
  setBaseUrl(baseUrl: string): void {
    this.baseUrl = normalizeBaseUrl(baseUrl);
  }

  /** The daemon dashboard URL (the base URL with a trailing slash). */
  dashboardUrl(): string {
    return this.baseUrl + "/";
  }

  /**
   * Push the latest IDE context to the daemon. Never throws: returns `"offline"`
   * when the daemon is unreachable and `"error"` for a non-2xx response.
   */
  async pushContext(context: VsCodeContext): Promise<PushResult> {
    const res = await this.request("POST", "/context/vscode", context);
    if (res === "offline") return "offline";
    return res.ok ? "ok" : "error";
  }

  /** Daemon health, or `null` when offline / on any error. */
  async health(): Promise<HealthStatus | null> {
    return this.getJson<HealthStatus>("/health");
  }

  /**
   * A grouped time summary over a window, or `null` when offline / on error.
   * Used (optionally) to show today's total in the status bar.
   */
  async summary(
    from: number,
    to: number,
    by = "category",
  ): Promise<SummaryReport | null> {
    const query = `?from=${from}&to=${to}&by=${encodeURIComponent(by)}`;
    return this.getJson<SummaryReport>("/report/summary" + query);
  }

  // ── internals ──────────────────────────────────────────────────────────

  private async getJson<T>(path: string): Promise<T | null> {
    const res = await this.request("GET", path);
    if (res === "offline" || !res.ok) return null;
    try {
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response | "offline"> {
    const fetchImpl = this.fetchImpl;
    if (!fetchImpl) return "offline";

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers: Record<string, string> = { accept: "application/json" };
    const init: RequestInit = { method, headers, signal: controller.signal };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    try {
      return await fetchImpl(this.baseUrl + path, init);
    } catch {
      // Connection refused, DNS, abort/timeout — the daemon is effectively
      // offline as far as the extension is concerned. Never throw.
      return "offline";
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Strip a trailing slash so we can append paths uniformly. */
function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}
