import type { WindowSample } from "@vtx-track/protocol";
import { swayAdapter } from "./sway.js";
import { hyprlandAdapter } from "./hyprland.js";
import { gnomeAdapter } from "./gnome.js";
import {
  currentWaylandEnv,
  type WaylandAdapter,
  type WaylandEnv,
} from "./types.js";

export type { WaylandAdapter, WaylandEnv } from "./types.js";
export { currentWaylandEnv } from "./types.js";
export { swayAdapter } from "./sway.js";
export { hyprlandAdapter } from "./hyprland.js";
export { gnomeAdapter } from "./gnome.js";

/**
 * All known Wayland adapters, in selection order. wlroots compositors (sway,
 * Hyprland) expose reliable IPC and come first; GNOME requires our companion
 * extension and is last (best-effort).
 */
export const WAYLAND_ADAPTERS: readonly WaylandAdapter[] = [
  swayAdapter,
  hyprlandAdapter,
  gnomeAdapter,
];

/** Pick the first adapter that can run in this environment, or null. */
export function selectWaylandAdapter(
  env: WaylandEnv = currentWaylandEnv(),
  adapters: readonly WaylandAdapter[] = WAYLAND_ADAPTERS,
): WaylandAdapter | null {
  return adapters.find((a) => a.isAvailable(env)) ?? null;
}

/** Convenience: query the active window via the selected adapter, or null. */
export async function getWaylandActiveWindow(
  env: WaylandEnv = currentWaylandEnv(),
): Promise<WindowSample | null> {
  const adapter = selectWaylandAdapter(env);
  return adapter ? adapter.getActiveWindow(env) : null;
}
