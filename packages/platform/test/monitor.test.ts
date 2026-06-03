import { describe, expect, it, vi } from "vitest";
import { DegradedMonitor, NativeMonitor, toSample } from "../src/monitor.js";
import { resolveCapabilities } from "../src/detect.js";
import type { ActiveWindowAddon, RealIdleAddon } from "../src/native.js";

const winCaps = resolveCapabilities({ platform: "win32" });

function fakeWindow(over: Partial<ActiveWindowAddon> = {}): ActiveWindowAddon {
  return {
    initialize: vi.fn(),
    getActiveWindow: () => ({
      title: "a.ts — Code",
      application: "Code",
      path: "C:/Apps/Code.exe",
      pid: 1234,
    }),
    subscribe: vi.fn(() => 1),
    unsubscribe: vi.fn(),
    ...over,
  };
}

function fakeIdle(over: Partial<RealIdleAddon> = {}): RealIdleAddon {
  return {
    getIdleSeconds: () => 3,
    getLocked: () => false,
    getIdlePrevented: () => false,
    getIdleState: () => "active",
    ...over,
  };
}

describe("toSample", () => {
  it("maps native info and keeps titles when allowed", () => {
    const s = toSample(
      { title: "t", application: "Code", path: "C:/x/Code.exe", pid: 9 },
      true,
    );
    expect(s).toEqual({ app: "Code", title: "t", exePath: "C:/x/Code.exe", pid: 9 });
  });

  it("drops titles when not allowed (e.g. wayland)", () => {
    const s = toSample(
      { title: "secret", application: "Code", path: "/x/Code", pid: 9 },
      false,
    );
    expect(s?.title).toBe("");
  });

  it("falls back to basename when application is empty", () => {
    const s = toSample(
      { title: "", application: "", path: "/usr/bin/nvim", pid: 1 },
      true,
    );
    expect(s?.app).toBe("nvim");
  });

  it("returns null for null input", () => {
    expect(toSample(null, true)).toBeNull();
  });
});

describe("NativeMonitor", () => {
  it("reads the active window", () => {
    const m = new NativeMonitor(winCaps, fakeWindow(), fakeIdle());
    expect(m.getActiveWindow()?.app).toBe("Code");
  });

  it("maps idle state and seconds", () => {
    const m = new NativeMonitor(
      winCaps,
      fakeWindow(),
      fakeIdle({ getIdleState: () => "idle", getIdleSeconds: () => 200 }),
    );
    const reading = m.getIdle(120);
    expect(reading.state).toBe("idle");
    expect(reading.idleSeconds).toBe(200);
  });

  it("normalizes unknown idle states", () => {
    const m = new NativeMonitor(
      winCaps,
      fakeWindow(),
      fakeIdle({ getIdleState: () => "bogus" as never }),
    );
    expect(m.getIdle(120).state).toBe("unknown");
  });

  it("subscribes and unsubscribes", () => {
    const unsub = vi.fn();
    const window = fakeWindow({ subscribe: vi.fn(() => 7), unsubscribe: unsub });
    const m = new NativeMonitor(winCaps, window, fakeIdle());
    const off = m.onWindowChange(() => {});
    off();
    expect(unsub).toHaveBeenCalledWith(7);
  });

  it("survives an addon that throws", () => {
    const m = new NativeMonitor(
      winCaps,
      fakeWindow({
        getActiveWindow: () => {
          throw new Error("native boom");
        },
      }),
      fakeIdle(),
    );
    expect(m.getActiveWindow()).toBeNull();
  });
});

describe("DegradedMonitor", () => {
  it("never reports a window but still reads idle", () => {
    const caps = resolveCapabilities({ platform: "linux", sessionType: "wayland" });
    const m = new DegradedMonitor(caps, fakeIdle({ getIdleState: () => "active" }));
    expect(m.getActiveWindow()).toBeNull();
    expect(m.getIdle(120).state).toBe("active");
  });

  it("reports unknown idle with no addon", () => {
    const caps = resolveCapabilities({ platform: "linux", sessionType: "wayland" });
    const m = new DegradedMonitor(caps, null);
    expect(m.getIdle(120).state).toBe("unknown");
  });
});
