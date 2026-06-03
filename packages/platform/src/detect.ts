import type { PlatformCapabilities } from "./types.js";

/** A minimal view of the environment, injectable for testing. */
export interface Env {
  platform: NodeJS.Platform;
  /** XDG_SESSION_TYPE, e.g. "wayland" | "x11". */
  sessionType?: string | undefined;
  /** Whether WAYLAND_DISPLAY is set. */
  waylandDisplay?: string | undefined;
}

/** Read the live environment. */
export function currentEnv(): Env {
  return {
    platform: process.platform,
    sessionType: process.env.XDG_SESSION_TYPE,
    waylandDisplay: process.env.WAYLAND_DISPLAY,
  };
}

/** True when the Linux session is Wayland (where active-window is unavailable). */
export function isWayland(env: Env): boolean {
  if (env.platform !== "linux") return false;
  if (env.sessionType?.toLowerCase() === "wayland") return true;
  if (env.sessionType?.toLowerCase() === "x11") return false;
  return Boolean(env.waylandDisplay);
}

/**
 * Resolve platform capabilities from the environment. This is the single source
 * of truth for what vtx-track can and cannot observe on a given machine.
 */
export function resolveCapabilities(env: Env = currentEnv()): PlatformCapabilities {
  const { platform } = env;

  if (platform === "linux" && isWayland(env)) {
    return {
      platform,
      canIdentifyWindow: false,
      canReadTitles: false,
      canReadIdle: true,
      canDetectIdlePrevented: true,
      canDetectLock: false,
      limitationNote:
        "Running under Wayland: the active window and title cannot be read " +
        "(Wayland's security model forbids it). Idle tracking still works; " +
        "app-level tracking requires X11 or a compositor adapter.",
    };
  }

  switch (platform) {
    case "win32":
      return {
        platform,
        canIdentifyWindow: true,
        canReadTitles: true,
        canReadIdle: true,
        canDetectIdlePrevented: false,
        canDetectLock: false,
      };
    case "darwin":
      return {
        platform,
        canIdentifyWindow: true,
        canReadTitles: true,
        canReadIdle: true,
        canDetectIdlePrevented: true,
        canDetectLock: true,
        limitationNote:
          "macOS requires Screen Recording permission to read window titles. " +
          "Grant it in System Settings → Privacy & Security → Screen Recording.",
      };
    case "linux":
      return {
        platform,
        canIdentifyWindow: true,
        canReadTitles: true,
        canReadIdle: true,
        canDetectIdlePrevented: true,
        canDetectLock: false,
      };
    default:
      return {
        platform,
        canIdentifyWindow: false,
        canReadTitles: false,
        canReadIdle: false,
        canDetectIdlePrevented: false,
        canDetectLock: false,
        limitationNote: `Unsupported platform: ${platform}.`,
      };
  }
}
