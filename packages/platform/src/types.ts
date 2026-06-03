import type { IdleReading, WindowSample } from "@vtx-track/protocol";

export type { IdleReading, WindowSample };

/** Callback invoked when the foreground window changes. */
export type WindowChangeListener = (sample: WindowSample | null) => void;

/**
 * Platform capability flags, resolved at startup. The daemon surfaces these so
 * clients can explain limitations honestly (e.g. "window titles unavailable on
 * Wayland") rather than silently recording bad data.
 */
export interface PlatformCapabilities {
  platform: NodeJS.Platform;
  /** Can we identify the active window/app at all? (false on Wayland). */
  canIdentifyWindow: boolean;
  /** Can we read window titles? (false on Wayland; needs perms on macOS). */
  canReadTitles: boolean;
  /** Can we read idle time? (true on all supported platforms). */
  canReadIdle: boolean;
  /** Can we detect video/meeting "idle prevented" state? */
  canDetectIdlePrevented: boolean;
  /** Can we detect a locked session? */
  canDetectLock: boolean;
  /** Human-readable reason for any limitation, for surfacing to users. */
  limitationNote?: string;
}

/**
 * The platform-agnostic activity monitor. Implementations wrap native addons;
 * the daemon depends only on this interface.
 */
export interface ActivityMonitor {
  /** Capabilities resolved for the current environment. */
  readonly capabilities: PlatformCapabilities;

  /** Initialize native resources and request any needed permissions. */
  start(): void;

  /** Read the current foreground window synchronously. */
  getActiveWindow(): WindowSample | null;

  /** Read the current idle state for a given threshold (seconds). */
  getIdle(idleThresholdSeconds: number): IdleReading;

  /** Subscribe to foreground-window changes. Returns an unsubscribe function. */
  onWindowChange(listener: WindowChangeListener): () => void;

  /** Release native resources. */
  stop(): void;
}
