import type {
  BrowserContext,
  Config,
  IdleReading,
  Segment,
  VsCodeContext,
  WindowSample,
} from "@vtx-track/protocol";
import {
  Categorizer,
  PrivacyFilter,
  Sessionizer,
  Store,
  type Observation,
} from "@vtx-track/core";
import type { ActivityMonitor } from "@vtx-track/platform";

/** A clock function, injectable for tests. Returns epoch ms. */
export type Clock = () => number;

export interface TrackerDeps {
  monitor: ActivityMonitor;
  store: Store;
  config: Config;
  /** Defaults to `Date.now`. */
  now?: Clock;
}

/**
 * The sampling engine. Owns the single timeline:
 *
 * - Subscribes to the monitor's focus-change events (precise boundaries).
 * - Runs a heartbeat every `config.heartbeatMs` to update duration, read idle,
 *   and catch in-app title changes.
 * - Folds observations through privacy → categorize → sessionizer, then writes
 *   closed segments to the store.
 *
 * VS Code / browser context arrives out-of-band via {@link setVsCodeContext} /
 * {@link setBrowserContext}, keyed by pid, and is attached only while that pid
 * is the foreground app — so the daemon stays the sole clock (no double count).
 */
export class Tracker {
  private readonly monitor: ActivityMonitor;
  private readonly store: Store;
  private readonly now: Clock;
  private config: Config;

  private categorizer: Categorizer;
  private privacy: PrivacyFilter;
  private readonly sessionizer: Sessionizer;

  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private paused = false;
  private lastSample: WindowSample | null = null;

  /** Latest VS Code context by pid (set by the extension bridge). */
  private vscodeByPid = new Map<number, { ctx: VsCodeContext; at: number }>();
  /** Latest browser context by pid (set by the browser extension bridge). */
  private browserByPid = new Map<number, { ctx: BrowserContext; at: number }>();
  /**
   * App icons (`data:image/png;base64,…`) keyed by app name, harvested live from
   * window samples. Kept in memory only — the dashboard fetches them via
   * `GET /icon`. Bounded by the number of distinct apps seen this run.
   */
  private iconByApp = new Map<string, string>();

  constructor(deps: TrackerDeps) {
    this.monitor = deps.monitor;
    this.store = deps.store;
    this.config = deps.config;
    this.now = deps.now ?? Date.now;
    this.categorizer = new Categorizer(deps.config.categoryRules);
    this.privacy = new PrivacyFilter(deps.config);
    this.sessionizer = new Sessionizer(deps.config.minSegmentMs);
  }

  /** Begin tracking. */
  start(): void {
    this.monitor.start();
    this.store.logEvent(this.now(), "daemon_start");
    this.lastSample = this.monitor.getActiveWindow();
    this.unsubscribe = this.monitor.onWindowChange((sample) => {
      this.lastSample = sample;
      this.tick();
    });
    this.heartbeat = setInterval(() => this.tick(), this.config.heartbeatMs);
    if (typeof this.heartbeat.unref === "function") this.heartbeat.unref();
    this.tick();
  }

  /** Stop tracking, flushing the open segment. */
  stop(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    const closed = this.sessionizer.flush(this.now());
    if (closed) this.store.insertSegment(closed);
    this.store.logEvent(this.now(), "daemon_stop");
    this.monitor.stop();
  }

  /** Pause tracking (logs a `private` gap until resumed). */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.store.logEvent(this.now(), "pause");
    this.tick();
  }

  /** Resume tracking. */
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.store.logEvent(this.now(), "resume");
    this.tick();
  }

  isPaused(): boolean {
    return this.paused;
  }

  /** Apply a new configuration at runtime (re-derives categorizer + privacy). */
  applyConfig(config: Config): void {
    this.config = config;
    this.categorizer = new Categorizer(config.categoryRules);
    this.privacy = new PrivacyFilter(config);
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = setInterval(() => this.tick(), config.heartbeatMs);
      if (typeof this.heartbeat.unref === "function") this.heartbeat.unref();
    }
  }

  /** Record VS Code context for a pid (from the extension). */
  setVsCodeContext(ctx: VsCodeContext): void {
    this.vscodeByPid.set(ctx.pid, { ctx, at: this.now() });
    // Refresh the open segment so the new context takes effect immediately
    // (and a project/branch change splits the segment at the right boundary).
    if (this.lastSample && this.lastSample.pid === ctx.pid) this.tick();
  }

  /** Record browser context for a pid (from the browser extension). */
  setBrowserContext(ctx: BrowserContext): void {
    this.browserByPid.set(ctx.pid, { ctx, at: this.now() });
    if (this.lastSample && this.lastSample.pid === ctx.pid) this.tick();
  }

  /**
   * One sampling step. Idempotent and cheap; called by the heartbeat and on
   * every focus-change event.
   */
  tick(): void {
    const at = this.now();
    const sample = this.lastSample ?? this.monitor.getActiveWindow() ?? UNKNOWN_SAMPLE;
    const idle = this.monitor.getIdle(this.config.idleThresholdSeconds);

    // Harvest the app icon (if the platform supplied one) so the dashboard can
    // show real logos. Kept in memory, never written to the timeline.
    if (sample.icon && sample.app && !this.iconByApp.has(sample.app)) {
      this.iconByApp.set(sample.app, sample.icon);
    }

    const browser = this.contextFor(this.browserByPid, sample.pid, at);
    const vscode = this.contextFor(this.vscodeByPid, sample.pid, at);
    const domain = browser?.domain;

    const decision = this.privacy.apply(sample, domain);
    const denied = this.paused || decision.denied;
    const category = this.categorizer.categorize(sample, domain);

    const obs: Observation = {
      at,
      sample,
      idle,
      category,
      title: decision.title,
      denied,
      vscode: vscode,
      browser: browser,
    };

    const closed = this.sessionizer.push(obs);
    if (closed) this.store.insertSegment(closed);
  }

  /** Most recent live segment start (for live duration in /health, etc.). */
  openSince(): number | null {
    return this.sessionizer.openStartedAt();
  }

  /**
   * Return context for a pid if it is fresh (set within 2 heartbeats). Stale
   * context is discarded so a backgrounded VS Code window doesn't keep
   * decorating unrelated segments.
   */
  private contextFor<T>(
    map: Map<number, { ctx: T; at: number }>,
    pid: number,
    at: number,
  ): T | undefined {
    const entry = map.get(pid);
    if (!entry) return undefined;
    if (at - entry.at > this.config.heartbeatMs * 2 + 1000) {
      map.delete(pid);
      return undefined;
    }
    return entry.ctx;
  }

  /** Expose recent segments for the API/reports. */
  segmentsBetween(from: number, to: number): Segment[] {
    return this.store.segmentsBetween(from, to);
  }

  /**
   * The cached icon (`data:image/png;base64,…`) for an app, or undefined if none
   * was captured. Used by the daemon's `GET /icon` endpoint.
   */
  iconFor(app: string): string | undefined {
    return this.iconByApp.get(app);
  }

  /** App names that currently have a cached icon. */
  appsWithIcons(): string[] {
    return [...this.iconByApp.keys()];
  }
}

const UNKNOWN_SAMPLE: WindowSample = {
  app: "unknown",
  title: "",
  exePath: "",
  pid: -1,
};

export type { IdleReading };
