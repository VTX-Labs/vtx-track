import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { WindowSample } from "@vtx-track/protocol";
import type { WaylandAdapter, WaylandEnv } from "./types.js";

const exec = promisify(execFile);

/**
 * GNOME (Mutter) adapter.
 *
 * GNOME on Wayland deliberately exposes **no** unprivileged "active window" API.
 * The supported path is a GNOME Shell extension that publishes the focused
 * window over D-Bus. vtx-track ships an optional companion extension
 * (`extensions/gnome/`) that implements `org.gnome.Shell.Extensions.VtxTrack`
 * with a `GetFocusedWindow` method returning `app|title|pid`. When that
 * extension is installed and enabled, this adapter reads it via `gdbus`.
 *
 * Without the extension, GNOME simply can't be introspected — this adapter
 * reports unavailable and the platform falls back to idle-only tracking. That
 * limitation is inherent to GNOME/Wayland, not a vtx-track shortcoming.
 */

const BUS = "org.gnome.Shell";
const OBJECT = "/org/gnome/Shell/Extensions/VtxTrack";
const IFACE = "org.gnome.Shell.Extensions.VtxTrack";

/** Parse the `gdbus` reply for our GetFocusedWindow method. */
export function parseGdbusReply(stdout: string): WindowSample | null {
  // gdbus prints e.g.: ('firefox|Mozilla Firefox|1234',)
  const m = stdout.match(/'([^']*)'/);
  if (!m || m[1] === undefined) return null;
  const parts = m[1].split("|");
  if (parts.length < 1 || !parts[0]) return null;
  const [app, title, pidStr] = parts;
  const pid = Number(pidStr);
  return {
    app: app || "unknown",
    title: title ?? "",
    exePath: "",
    pid: Number.isFinite(pid) ? pid : -1,
  };
}

export const gnomeAdapter: WaylandAdapter = {
  name: "gnome",
  isAvailable(env: WaylandEnv): boolean {
    const d = env.desktop?.toLowerCase() ?? "";
    return d.includes("gnome");
  },
  async getActiveWindow(): Promise<WindowSample | null> {
    try {
      const { stdout } = await exec(
        "gdbus",
        [
          "call",
          "--session",
          "--dest",
          BUS,
          "--object-path",
          OBJECT,
          "--method",
          `${IFACE}.GetFocusedWindow`,
        ],
        { timeout: 1000 },
      );
      return parseGdbusReply(stdout);
    } catch {
      // Extension not installed / not enabled / gdbus missing.
      return null;
    }
  },
};
