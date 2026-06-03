import { currentEnv, resolveCapabilities, isWayland, type Env } from "./detect.js";
import { loadActiveWindow, loadRealIdle } from "./native.js";
import { DegradedMonitor, NativeMonitor, toSample } from "./monitor.js";
import type { ActivityMonitor, PlatformCapabilities } from "./types.js";

export type {
  ActivityMonitor,
  PlatformCapabilities,
  WindowChangeListener,
  IdleReading,
  WindowSample,
} from "./types.js";
export { resolveCapabilities, isWayland, currentEnv, type Env } from "./detect.js";
export { NativeMonitor, DegradedMonitor, toSample } from "./monitor.js";

/**
 * Build the best available {@link ActivityMonitor} for the current environment.
 *
 * - On Windows/macOS/Linux-X11 with the addons present → {@link NativeMonitor}.
 * - On Wayland, or when the active-window addon is missing → a
 *   {@link DegradedMonitor} that still does idle accounting where possible.
 *
 * Never throws: a fully unavailable environment yields an idle-less degraded
 * monitor so the daemon can run (and report its own limitations) regardless.
 */
export async function createMonitor(env: Env = currentEnv()): Promise<ActivityMonitor> {
  const capabilities = resolveCapabilities(env);
  const idle = capabilities.canReadIdle ? await loadRealIdle() : null;

  if (!capabilities.canIdentifyWindow) {
    return new DegradedMonitor(capabilities, idle);
  }

  const window = await loadActiveWindow();
  if (!window) {
    // The platform should support it, but the addon failed to load. Degrade and
    // annotate so the user understands why app tracking is off.
    return new DegradedMonitor(
      {
        ...capabilities,
        canIdentifyWindow: false,
        canReadTitles: false,
        limitationNote:
          "The active-window native addon could not be loaded. Reinstall " +
          "dependencies, or see README → Troubleshooting.",
      },
      idle,
    );
  }

  return new NativeMonitor(capabilities, window, idle);
}

/** Re-export for callers that only need the capability summary (e.g. /health). */
export function describeCapabilities(env: Env = currentEnv()): PlatformCapabilities {
  return resolveCapabilities(env);
}
