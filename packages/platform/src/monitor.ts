import type { ActivityState, IdleReading, WindowSample } from "@vtx-track/protocol";
import type {
  ActivityMonitor,
  PlatformCapabilities,
  WindowChangeListener,
} from "./types.js";
import type { ActiveWindowAddon, NativeWindowInfo, RealIdleAddon } from "./native.js";

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
