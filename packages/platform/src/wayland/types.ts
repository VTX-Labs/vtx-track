import type { WindowSample } from "@vtx-track/protocol";

/**
 * A Wayland compositor adapter knows how to ask one compositor (or family of
 * compositors) which window is focused. Wayland has no portable, unprivileged
 * "active window" API by design, so each compositor exposes its own IPC:
 *
 *  - **Sway / i3** (wlroots): a JSON IPC socket (`$SWAYSOCK` / `$I3SOCK`).
 *  - **Hyprland** (wlroots): a line socket under `$XDG_RUNTIME_DIR/hypr/…`.
 *  - **GNOME / KDE**: D-Bus (Shell/KWin scripting) — far more restricted.
 *
 * Adapters are intentionally side-effect-light and dependency-free: they speak
 * the compositor's wire format over a Unix socket or a CLI, so the parsing is
 * unit-testable from fixtures on any OS even though a live session is Linux-only.
 */
export interface WaylandAdapter {
  /** Compositor family this adapter serves, for logging/diagnostics. */
  readonly name: string;
  /** True if this adapter can run in the current environment. */
  isAvailable(env: WaylandEnv): boolean;
  /** Query the focused window, or null if none / on any error. */
  getActiveWindow(env: WaylandEnv): Promise<WindowSample | null>;
}

/** The environment slice Wayland adapters read. Injectable for testing. */
export interface WaylandEnv {
  /** $XDG_CURRENT_DESKTOP, e.g. "sway", "Hyprland", "GNOME", "KDE". */
  desktop?: string | undefined;
  /** $SWAYSOCK — Sway's IPC socket path. */
  swaySock?: string | undefined;
  /** $I3SOCK — i3's IPC socket path (i3 on X11, but sway-compatible). */
  i3Sock?: string | undefined;
  /** $HYPRLAND_INSTANCE_SIGNATURE — identifies the running Hyprland instance. */
  hyprlandSignature?: string | undefined;
  /** $XDG_RUNTIME_DIR — base dir for per-user runtime sockets. */
  xdgRuntimeDir?: string | undefined;
}

/** Read the live Wayland-relevant environment. */
export function currentWaylandEnv(): WaylandEnv {
  return {
    desktop: process.env.XDG_CURRENT_DESKTOP,
    swaySock: process.env.SWAYSOCK,
    i3Sock: process.env.I3SOCK,
    hyprlandSignature: process.env.HYPRLAND_INSTANCE_SIGNATURE,
    xdgRuntimeDir: process.env.XDG_RUNTIME_DIR,
  };
}
