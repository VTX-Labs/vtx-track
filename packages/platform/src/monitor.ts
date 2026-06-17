import type { ActivityState, IdleReading, WindowSample } from "@vtx-track/protocol";
import type {
  ActivityMonitor,
  PlatformCapabilities,
  WindowChangeListener,
} from "./types.js";
import type { ActiveWindowAddon, NativeWindowInfo, RealIdleAddon } from "./native.js";
import type { WaylandAdapter, WaylandEnv } from "./wayland/index.js";

/** Map a native window info into our protocol {@link WindowSample}. */
export function toSample(
  info: NativeWindowInfo | null,
  canReadTitles: boolean,
): WindowSample | null {
  if (!info) return null;
  return {
    app: info.application || basename(info.path) || "unknown",
    title: canReadTitles ? info.title : "",
    exePath: info.path ?? "",
    pid: typeof info.pid === "number" ? info.pid : -1,
    // The native addon returns a `data:image/png;base64,…` icon on Windows/macOS.
    // Carry it through; the daemon caches it per-app to serve to the dashboard.
    ...(typeof info.icon === "string" && info.icon ? { icon: info.icon } : {}),
  };
}

/**
 * The production monitor. Wraps `@paymoapp/active-window` for the foreground
 * window and `@paymoapp/real-idle` for idle/lock/idle-prevented state.
 */
export class NativeMonitor implements ActivityMonitor {
  readonly capabilities: PlatformCapabilities;
  private readonly window: ActiveWindowAddon | null;
  private readonly idle: RealIdleAddon | null;
  private watchId: number | null = null;
  private started = false;

  constructor(
    capabilities: PlatformCapabilities,
    window: ActiveWindowAddon | null,
    idle: RealIdleAddon | null,
  ) {
    this.capabilities = capabilities;
    this.window = window;
    this.idle = idle;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    if (this.window) {
      // `osxRunLoop: "all"` is required so subscriptions fire in a headless
      // (non-GUI) process such as our daemon; harmless elsewhere.
      this.window.initialize({ osxRunLoop: "all" });
      if (
        this.capabilities.platform === "darwin" &&
        typeof this.window.requestPermissions === "function"
      ) {
        this.window.requestPermissions();
      }
    }
  }

  getActiveWindow(): WindowSample | null {
    if (!this.window) return null;
    try {
      return toSample(this.window.getActiveWindow(), this.capabilities.canReadTitles);
    } catch {
      return null;
    }
  }

  getIdle(idleThresholdSeconds: number): IdleReading {
    if (!this.idle) {
      return { state: "unknown", idleSeconds: -1, locked: false };
    }
    try {
      const state = normalizeState(this.idle.getIdleState(idleThresholdSeconds));
      const idleSeconds = safeNumber(this.idle.getIdleSeconds(), -1);
      const locked = this.capabilities.canDetectLock
        ? safeBool(() => this.idle!.getLocked())
        : state === "locked";
      return { state, idleSeconds, locked };
    } catch {
      return { state: "unknown", idleSeconds: -1, locked: false };
    }
  }

  onWindowChange(listener: WindowChangeListener): () => void {
    if (!this.window) return () => {};
    const canReadTitles = this.capabilities.canReadTitles;
    this.watchId = this.window.subscribe((info) => {
      listener(toSample(info, canReadTitles));
    });
    return () => {
      if (this.watchId !== null && this.window) {
        try {
          this.window.unsubscribe(this.watchId);
        } catch {
          /* ignore */
        }
        this.watchId = null;
      }
    };
  }

  stop(): void {
    if (this.watchId !== null && this.window) {
      try {
        this.window.unsubscribe(this.watchId);
      } catch {
        /* ignore */
      }
      this.watchId = null;
    }
    this.started = false;
  }
}

/**
 * A monitor for environments where the active window can't be identified
 * (Wayland, or no addon). Idle tracking still works when a real-idle addon is
 * present, so whole-day idle/active accounting is preserved even without app
 * identity.
 */
export class DegradedMonitor implements ActivityMonitor {
  readonly capabilities: PlatformCapabilities;
  private readonly idle: RealIdleAddon | null;

  constructor(capabilities: PlatformCapabilities, idle: RealIdleAddon | null) {
    this.capabilities = capabilities;
    this.idle = idle;
  }

  start(): void {
    /* nothing to initialize */
  }

  getActiveWindow(): WindowSample | null {
    return null;
  }

  getIdle(idleThresholdSeconds: number): IdleReading {
    if (!this.idle) return { state: "unknown", idleSeconds: -1, locked: false };
    try {
      return {
        state: normalizeState(this.idle.getIdleState(idleThresholdSeconds)),
        idleSeconds: safeNumber(this.idle.getIdleSeconds(), -1),
        locked: safeBool(() => this.idle!.getLocked()),
      };
    } catch {
      return { state: "unknown", idleSeconds: -1, locked: false };
    }
  }

  onWindowChange(): () => void {
    return () => {};
  }

  stop(): void {
    /* nothing to release */
  }
}

/**
 * A monitor for Wayland sessions, using a compositor adapter (sway/i3,
 * Hyprland, or GNOME via our companion extension) to read the focused window.
 * Wayland has no portable change subscription, so window changes are surfaced
 * by polling the adapter; idle/lock state comes from the real-idle addon.
 *
 * If the adapter can't read a window (e.g. GNOME without the extension), this
 * behaves like a {@link DegradedMonitor} — idle accounting still works.
 */
export class WaylandMonitor implements ActivityMonitor {
  readonly capabilities: PlatformCapabilities;
  private readonly adapter: WaylandAdapter;
  private readonly env: WaylandEnv;
  private readonly idle: RealIdleAddon | null;
  private readonly pollMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private last: WindowSample | null = null;
  private listeners = new Set<WindowChangeListener>();
  private polling = false;

  constructor(
    capabilities: PlatformCapabilities,
    adapter: WaylandAdapter,
    env: WaylandEnv,
    idle: RealIdleAddon | null,
    pollMs = 2000,
  ) {
    this.capabilities = capabilities;
    this.adapter = adapter;
    this.env = env;
    this.idle = idle;
    this.pollMs = pollMs;
  }

  start(): void {
    if (this.timer) return;
    // Wayland has no portable change subscription, so we poll the adapter and
    // cache the latest sample; getActiveWindow() then answers synchronously.
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.pollMs);
    if (this.timer.unref) this.timer.unref();
  }

  /** Returns the most recent sampled window (the poll loop keeps it fresh). */
  getActiveWindow(): WindowSample | null {
    return this.last;
  }

  getIdle(idleThresholdSeconds: number): IdleReading {
    if (!this.idle) return { state: "unknown", idleSeconds: -1, locked: false };
    try {
      return {
        state: normalizeState(this.idle.getIdleState(idleThresholdSeconds)),
        idleSeconds: safeNumber(this.idle.getIdleSeconds(), -1),
        locked: safeBool(() => this.idle!.getLocked()),
      };
    } catch {
      return { state: "unknown", idleSeconds: -1, locked: false };
    }
  }

  onWindowChange(listener: WindowChangeListener): () => void {
    this.listeners.add(listener);
    // Ensure the poll loop is running even if start() wasn't called first.
    this.start();
    return () => {
      this.listeners.delete(listener);
    };
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.listeners.clear();
  }

  /** Sample the adapter once and notify listeners on change. Never throws. */
  private async poll(): Promise<void> {
    if (this.polling) return; // avoid overlap if a query is slow
    this.polling = true;
    try {
      let sample: WindowSample | null = null;
      try {
        sample = await this.adapter.getActiveWindow(this.env);
      } catch {
        sample = null;
      }
      if (sample && !this.capabilities.canReadTitles) {
        sample = { ...sample, title: "" };
      }
      if (!sameWindow(sample, this.last)) {
        this.last = sample;
        for (const l of this.listeners) l(sample);
      }
    } finally {
      this.polling = false;
    }
  }
}

/** True when two window samples refer to the same app+title+pid. */
function sameWindow(a: WindowSample | null, b: WindowSample | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.app === b.app && a.title === b.title && a.pid === b.pid;
}

function normalizeState(state: string): ActivityState {
  switch (state) {
    case "active":
    case "idlePrevented":
    case "idle":
    case "locked":
      return state;
    default:
      return "unknown";
  }
}

function safeNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function safeBool(fn: () => boolean): boolean {
  try {
    return Boolean(fn());
  } catch {
    return false;
  }
}

function basename(p: string): string {
  if (!p) return "";
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] ?? "";
}
