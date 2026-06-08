import { connect } from "node:net";
import { posix as pathPosix } from "node:path";
import type { WindowSample } from "@vtx-track/protocol";
import type { WaylandAdapter, WaylandEnv } from "./types.js";

/**
 * Hyprland IPC adapter.
 *
 * Hyprland exposes a control socket at
 * `$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/.socket.sock`. Writing the
 * command `j/activewindow` returns a JSON object describing the focused window,
 * including `class`, `title`, and `pid`. Some Hyprland versions place the socket
 * directly under `$XDG_RUNTIME_DIR/hypr/.socket.sock`; we try both.
 *
 * The reply parsing is pure and unit-tested; only the socket round-trip is
 * Linux-only.
 */

/** Subset of Hyprland's `activewindow` JSON we read. */
export interface HyprWindow {
  class?: string;
  initialClass?: string;
  title?: string;
  pid?: number;
  address?: string;
}

/** Candidate socket paths for the running Hyprland instance. */
export function socketCandidates(env: WaylandEnv): string[] {
  const base = env.xdgRuntimeDir;
  if (!base) return [];
  // These are always Linux paths, so join with POSIX semantics regardless of
  // the host OS running the tests.
  const paths: string[] = [];
  if (env.hyprlandSignature) {
    paths.push(
      pathPosix.join(base, "hypr", env.hyprlandSignature, ".socket.sock"),
    );
  }
  paths.push(pathPosix.join(base, "hypr", ".socket.sock"));
  return paths;
}

/** Map Hyprland's active-window JSON to a {@link WindowSample}. */
export function hyprToSample(win: HyprWindow): WindowSample | null {
  // Hyprland returns an empty object / "Invalid" when no window is focused.
  const app = win.class || win.initialClass || "";
  if (!app && !win.title) return null;
  return {
    app: app || "unknown",
    title: win.title ?? "",
    exePath: "",
    pid: typeof win.pid === "number" ? win.pid : -1,
  };
}

/** Send one command to a Hyprland socket and return the raw reply text. */
export function queryHypr(
  socketPath: string,
  command: string,
  timeoutMs = 1000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = connect(socketPath);
    const chunks: Buffer[] = [];
    let settled = false;
    const done = (err: Error | null, value?: string): void => {
      if (settled) return;
      settled = true;
      sock.destroy();
      if (err) reject(err);
      else resolve(value ?? "");
    };
    const timer = setTimeout(
      () => done(new Error("hyprland IPC: timeout")),
      timeoutMs,
    );
    if (timer.unref) timer.unref();

    sock.on("connect", () => sock.write(command));
    sock.on("data", (d: Buffer) => chunks.push(d));
    sock.on("end", () => {
      clearTimeout(timer);
      done(null, Buffer.concat(chunks).toString("utf8"));
    });
    sock.on("error", (e) => {
      clearTimeout(timer);
      done(e);
    });
  });
}

export const hyprlandAdapter: WaylandAdapter = {
  name: "hyprland",
  isAvailable(env: WaylandEnv): boolean {
    return (
      env.desktop?.toLowerCase().includes("hyprland") === true ||
      (Boolean(env.hyprlandSignature) && Boolean(env.xdgRuntimeDir))
    );
  },
  async getActiveWindow(env: WaylandEnv): Promise<WindowSample | null> {
    for (const socketPath of socketCandidates(env)) {
      try {
        const reply = await queryHypr(socketPath, "j/activewindow");
        const trimmed = reply.trim();
        if (!trimmed || trimmed === "Invalid") continue;
        const win = JSON.parse(trimmed) as HyprWindow;
        const sample = hyprToSample(win);
        if (sample) return sample;
      } catch {
        // try the next candidate socket
      }
    }
    return null;
  },
};
