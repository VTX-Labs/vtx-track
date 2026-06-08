import { currentEnv, resolveCapabilities, isWayland, type Env } from "./detect.js";
import { loadActiveWindow, loadRealIdle } from "./native.js";
import {
  DegradedMonitor,
  NativeMonitor,
  WaylandMonitor,
  toSample,
} from "./monitor.js";
import {
  currentWaylandEnv,
  selectWaylandAdapter,
} from "./wayland/index.js";
import type { ActivityMonitor, PlatformCapabilities } from "./types.js";

export type {
  ActivityMonitor,
  PlatformCapabilities,
  WindowChangeListener,
  IdleReading,
  WindowSample,
} from "./types.js";
export { resolveCapabilities, isWayland, currentEnv, type Env } from "./detect.js";
export {
  NativeMonitor,
  DegradedMonitor,
  WaylandMonitor,
  toSample,
} from "./monitor.js";
export {
  WAYLAND_ADAPTERS,
  selectWaylandAdapter,
  getWaylandActiveWindow,
  currentWaylandEnv,
  swayAdapter,
  hyprlandAdapter,
  gnomeAdapter,
  type WaylandAdapter,
  type WaylandEnv,
} from "./wayland/index.js";

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

  // On Wayland, try a compositor adapter (sway/i3, Hyprland, GNOME-via-extension)
  // before degrading. When one is available we *can* identify the window after
  // all — upgrade the capability flags and run the WaylandMonitor.
  if (capabilities.platform === "linux" && isWayland(env)) {
    const waylandEnv = currentWaylandEnv();
    const adapter = selectWaylandAdapter(waylandEnv);
    if (adapter) {
      return new WaylandMonitor(
        {
          ...capabilities,
          canIdentifyWindow: true,
          canReadTitles: true,
          limitationNote:
            `Wayland (${adapter.name}): window/title read via the compositor's ` +
            "IPC. GNOME requires the bundled vtx-track Shell extension.",
        },
        adapter,
        waylandEnv,
        idle,
      );
    }
    // No adapter for this compositor — idle-only, with the existing note.
    return new DegradedMonitor(capabilities, idle);
  }

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
