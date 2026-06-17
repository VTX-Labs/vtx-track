import type {
  Config,
  FocusReport,
  GroupBy,
  HealthStatus,
  Segment,
  StandupReport,
  SummaryReport,
  TimesheetReport,
} from "./types.js";

/** Options for constructing a {@link DaemonClient}. */
export interface DaemonClientOptions {
  /** Base URL of the daemon HTTP API. Defaults to `http://127.0.0.1:7842`. */
  baseUrl?: string;
  /**
   * Local control token (from `~/.vtx-track/token`). Required for control and
   * config endpoints; read endpoints work without it on localhost.
   */
  token?: string;
  /** Custom fetch implementation (for tests). Defaults to global `fetch`. */
  fetch?: typeof fetch;
}

/** Error thrown when the daemon returns a non-2xx response. */
export class DaemonError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "DaemonError";
  }
}

/** Thrown when the daemon can't be reached at all (not running). */
export class DaemonOfflineError extends Error {
  constructor(cause: unknown) {
    super("vtx-track daemon is not reachable — is it running?", { cause });
    this.name = "DaemonOfflineError";
  }
}

interface Range {
  from: number;
  to: number;
}

/**
 * A small, fully-typed client for the daemon's localhost HTTP API. Every method
 * maps to one endpoint documented in DESIGN.md §9.
 */
export class DaemonClient {
  private readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: DaemonClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? "http://127.0.0.1:7842").replace(/\/$/, "");
    this.token = opts.token;
    // Bind to globalThis: the browser's `window.fetch` throws "Illegal
    // invocation" if called as a method of another object (i.e. detached from
    // `window`). Node's fetch doesn't care, which is why this only bit browsers.
    const f = opts.fetch ?? globalThis.fetch;
    this.fetchImpl = f.bind(globalThis);
  }

  /** Daemon liveness + capability summary. */
  health(): Promise<HealthStatus> {
    return this.get<HealthStatus>("/health");
  }

  /** Is the daemon reachable? Never throws. */
  async isOnline(): Promise<boolean> {
    try {
      await this.health();
      return true;
    } catch {
      return false;
    }
  }

  /** Grouped time summary over a window. */
  summary(range: Range, groupBy: GroupBy): Promise<SummaryReport> {
    return this.get<SummaryReport>("/report/summary", {
      from: range.from,
      to: range.to,
      by: groupBy,
    });
  }

  /** Raw segments for a timeline view. */
  timeline(range: Range): Promise<Segment[]> {
    return this.get<Segment[]>("/report/timeline", {
      from: range.from,
      to: range.to,
    });
  }

  /** Focus / context-switch metrics for a date (YYYY-MM-DD). */
  focus(date: string): Promise<FocusReport> {
    return this.get<FocusReport>("/report/focus", { date });
  }

  /** Generated standup summary for a date. */
  standup(date: string): Promise<StandupReport> {
    return this.get<StandupReport>("/report/standup", { date });
  }

  /** Billable timesheet rollup. */
  timesheet(range: Range, groupBy: GroupBy): Promise<TimesheetReport> {
    return this.get<TimesheetReport>("/report/timesheet", {
      from: range.from,
      to: range.to,
      by: groupBy,
    });
  }

  /** Read the current daemon configuration. */
  getConfig(): Promise<Config> {
    return this.get<Config>("/config");
  }

  /** App names that have a real icon available from `iconUrl`. */
  iconApps(): Promise<{ apps: string[] }> {
    return this.get<{ apps: string[] }>("/icons");
  }

  /**
   * URL of an app's real icon PNG (served by the daemon). Returns a string for
   * use as an `<img src>`; the endpoint 404s when no icon exists so the caller
   * can fall back to a generated badge via the image's `onerror`.
   */
  iconUrl(app: string): string {
    return `${this.baseUrl}/icon?app=${encodeURIComponent(app)}`;
  }

  /** Update configuration (control token required). Returns the merged config. */
  setConfig(patch: Partial<Config>): Promise<Config> {
    return this.send<Config>("PUT", "/config", patch);
  }

  /** Pause tracking until resumed (control token required). */
  pause(): Promise<HealthStatus> {
    return this.send<HealthStatus>("POST", "/control/pause");
  }

  /** Resume tracking (control token required). */
  resume(): Promise<HealthStatus> {
    return this.send<HealthStatus>("POST", "/control/resume");
  }

  /** Delete all tracked data (control token required, confirmation enforced). */
  wipe(confirm: true): Promise<{ deleted: number }> {
    return this.send<{ deleted: number }>("POST", "/control/wipe", { confirm });
  }

  // ── internals ──────────────────────────────────────────────────────────

  private async get<T>(
    path: string,
    query?: Record<string, string | number>,
  ): Promise<T> {
    const url = new URL(this.baseUrl + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        url.searchParams.set(k, String(v));
      }
    }
    return this.request<T>("GET", url.toString());
  }

  private async send<T>(
    method: "POST" | "PUT",
    path: string,
    body?: unknown,
  ): Promise<T> {
    return this.request<T>(method, this.baseUrl + path, body);
  }

  private async request<T>(
    method: string,
    url: string,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    let init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      init = { ...init, body: JSON.stringify(body) };
    }

    let res: Response;
    try {
      res = await this.fetchImpl(url, init);
    } catch (err) {
      throw new DaemonOfflineError(err);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new DaemonError(
        text || `${res.status} ${res.statusText}`,
        res.status,
      );
    }
    return (await res.json()) as T;
  }
}
