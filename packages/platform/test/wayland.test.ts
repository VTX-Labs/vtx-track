import { describe, expect, it, vi } from "vitest";
import { WaylandMonitor } from "../src/monitor.js";
import type { WindowSample } from "@vtx-track/protocol";
import type { WaylandAdapter } from "../src/wayland/types.js";
import type { PlatformCapabilities } from "../src/types.js";
import {
  encodeRequest,
  decodeReply,
  findFocused,
  nodeToSample,
  type SwayNode,
} from "../src/wayland/sway.js";
import {
  hyprToSample,
  socketCandidates,
  type HyprWindow,
} from "../src/wayland/hyprland.js";
import { parseGdbusReply } from "../src/wayland/gnome.js";
import {
  selectWaylandAdapter,
  swayAdapter,
  hyprlandAdapter,
  gnomeAdapter,
} from "../src/wayland/index.js";
import type { WaylandEnv } from "../src/wayland/types.js";

// ── sway/i3 IPC ──────────────────────────────────────────────────────────────

describe("sway IPC framing", () => {
  it("round-trips a request through decodeReply", () => {
    // A reply uses the same framing as a request, so encode→decode validates both.
    const frame = encodeRequest(4, '{"hello":"world"}');
    const reply = decodeReply(frame);
    expect(reply).not.toBeNull();
    expect(reply?.type).toBe(4);
    expect(JSON.parse(reply!.json)).toEqual({ hello: "world" });
    expect(reply?.consumed).toBe(frame.length);
  });

  it("returns null when the frame is incomplete", () => {
    const frame = encodeRequest(4, '{"a":1}');
    expect(decodeReply(frame.subarray(0, 8))).toBeNull(); // header only
    expect(decodeReply(frame.subarray(0, frame.length - 2))).toBeNull();
  });

  it("throws on bad magic", () => {
    const bad = Buffer.alloc(20);
    bad.write("BADMAG", 0, "ascii");
    expect(() => decodeReply(bad)).toThrow(/bad magic/);
  });
});

describe("sway tree walk", () => {
  const tree: SwayNode = {
    nodes: [
      {
        nodes: [
          { focused: false, name: "Terminal", app_id: "Alacritty" },
          {
            focused: true,
            name: "vtx-track — README.md",
            app_id: "code",
            pid: 4242,
          },
        ],
      },
    ],
    floating_nodes: [],
  };

  it("finds the focused node", () => {
    const focused = findFocused(tree);
    expect(focused?.app_id).toBe("code");
  });

  it("maps a focused node to a sample", () => {
    const sample = nodeToSample(findFocused(tree)!);
    expect(sample).toEqual({
      app: "code",
      title: "vtx-track — README.md",
      exePath: "",
      pid: 4242,
    });
  });

  it("falls back to window_properties.class for X11 (i3) windows", () => {
    const node: SwayNode = {
      focused: true,
      name: "GIMP",
      window_properties: { class: "Gimp", title: "GIMP" },
    };
    expect(nodeToSample(node).app).toBe("Gimp");
  });

  it("returns null when nothing is focused", () => {
    expect(findFocused({ nodes: [{ focused: false }] })).toBeNull();
  });
});

// ── Hyprland IPC ─────────────────────────────────────────────────────────────

describe("hyprland", () => {
  it("maps activewindow JSON to a sample", () => {
    const win: HyprWindow = {
      class: "firefox",
      title: "vtx-track - GitHub",
      pid: 9090,
    };
    expect(hyprToSample(win)).toEqual({
      app: "firefox",
      title: "vtx-track - GitHub",
      exePath: "",
      pid: 9090,
    });
  });

  it("returns null for an empty (no-focus) window", () => {
    expect(hyprToSample({})).toBeNull();
  });

  it("builds signature-scoped then fallback socket paths", () => {
    const env: WaylandEnv = {
      xdgRuntimeDir: "/run/user/1000",
      hyprlandSignature: "abc123",
    };
    expect(socketCandidates(env)).toEqual([
      "/run/user/1000/hypr/abc123/.socket.sock",
      "/run/user/1000/hypr/.socket.sock",
    ]);
  });

  it("yields no paths without a runtime dir", () => {
    expect(socketCandidates({})).toEqual([]);
  });
});

// ── GNOME D-Bus ──────────────────────────────────────────────────────────────

describe("gnome gdbus reply parsing", () => {
  it("parses the app|title|pid tuple", () => {
    const sample = parseGdbusReply("('code|main.ts — vtx-track|3131',)\n");
    expect(sample).toEqual({
      app: "code",
      title: "main.ts — vtx-track",
      exePath: "",
      pid: 3131,
    });
  });

  it("returns null on an empty reply", () => {
    expect(parseGdbusReply("('',)")).toBeNull();
  });
});

// ── adapter selection ────────────────────────────────────────────────────────

describe("selectWaylandAdapter", () => {
  it("prefers sway when SWAYSOCK is set", () => {
    const env: WaylandEnv = { swaySock: "/run/sway-ipc.sock", desktop: "sway" };
    expect(selectWaylandAdapter(env)).toBe(swayAdapter);
  });

  it("selects hyprland by signature", () => {
    const env: WaylandEnv = {
      desktop: "Hyprland",
      hyprlandSignature: "sig",
      xdgRuntimeDir: "/run/user/1000",
    };
    expect(selectWaylandAdapter(env)).toBe(hyprlandAdapter);
  });

  it("selects gnome by desktop name", () => {
    const env: WaylandEnv = { desktop: "GNOME" };
    expect(selectWaylandAdapter(env)).toBe(gnomeAdapter);
  });

  it("returns null for an unknown compositor", () => {
    expect(selectWaylandAdapter({ desktop: "weston" })).toBeNull();
  });
});

// ── WaylandMonitor poll loop ─────────────────────────────────────────────────

const CAPS: PlatformCapabilities = {
  platform: "linux",
  canIdentifyWindow: true,
  canReadTitles: true,
  canReadIdle: true,
  canDetectIdlePrevented: true,
  canDetectLock: false,
};

function fakeAdapter(samples: (WindowSample | null)[]): WaylandAdapter {
  let i = 0;
  return {
    name: "fake",
    isAvailable: () => true,
    async getActiveWindow(): Promise<WindowSample | null> {
      const s = samples[Math.min(i, samples.length - 1)] ?? null;
      i++;
      return s;
    },
  };
}

describe("WaylandMonitor", () => {
  it("caches the latest sample and emits on change", async () => {
    vi.useFakeTimers();
    try {
      const a: WindowSample = { app: "code", title: "a", exePath: "", pid: 1 };
      const b: WindowSample = { app: "firefox", title: "b", exePath: "", pid: 2 };
      const monitor = new WaylandMonitor(CAPS, fakeAdapter([a, a, b]), {}, null, 1000);
      const seen: (WindowSample | null)[] = [];
      monitor.onWindowChange((s) => seen.push(s));

      // initial poll (scheduled as a microtask inside start())
      await vi.advanceTimersByTimeAsync(0);
      expect(monitor.getActiveWindow()).toEqual(a);

      await vi.advanceTimersByTimeAsync(1000); // 2nd poll: same → no emit
      await vi.advanceTimersByTimeAsync(1000); // 3rd poll: b → emit
      expect(monitor.getActiveWindow()).toEqual(b);
      expect(seen).toEqual([a, b]); // only changes, not every poll

      monitor.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("blanks titles when the capability is off", async () => {
    vi.useFakeTimers();
    try {
      const a: WindowSample = { app: "code", title: "secret", exePath: "", pid: 1 };
      const caps = { ...CAPS, canReadTitles: false };
      const monitor = new WaylandMonitor(caps, fakeAdapter([a]), {}, null, 1000);
      monitor.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(monitor.getActiveWindow()).toEqual({ ...a, title: "" });
      monitor.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
