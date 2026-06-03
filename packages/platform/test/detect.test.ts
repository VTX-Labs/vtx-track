import { describe, expect, it } from "vitest";
import { isWayland, resolveCapabilities, type Env } from "../src/detect.js";

const win: Env = { platform: "win32" };
const mac: Env = { platform: "darwin" };
const x11: Env = { platform: "linux", sessionType: "x11" };
const wayland: Env = { platform: "linux", sessionType: "wayland" };
const waylandByDisplay: Env = { platform: "linux", waylandDisplay: "wayland-0" };

describe("isWayland", () => {
  it("detects wayland by session type", () => {
    expect(isWayland(wayland)).toBe(true);
  });
  it("detects wayland by WAYLAND_DISPLAY", () => {
    expect(isWayland(waylandByDisplay)).toBe(true);
  });
  it("returns false for x11", () => {
    expect(isWayland(x11)).toBe(false);
  });
  it("returns false on non-linux", () => {
    expect(isWayland(win)).toBe(false);
    expect(isWayland(mac)).toBe(false);
  });
});

describe("resolveCapabilities", () => {
  it("windows can identify windows and titles, no idle-prevented", () => {
    const c = resolveCapabilities(win);
    expect(c.canIdentifyWindow).toBe(true);
    expect(c.canReadTitles).toBe(true);
    expect(c.canDetectIdlePrevented).toBe(false);
  });

  it("macOS notes the screen-recording permission and detects lock", () => {
    const c = resolveCapabilities(mac);
    expect(c.canDetectLock).toBe(true);
    expect(c.limitationNote).toMatch(/Screen Recording/i);
  });

  it("linux x11 is fully capable", () => {
    const c = resolveCapabilities(x11);
    expect(c.canIdentifyWindow).toBe(true);
    expect(c.canReadTitles).toBe(true);
  });

  it("wayland disables window identification but keeps idle", () => {
    const c = resolveCapabilities(wayland);
    expect(c.canIdentifyWindow).toBe(false);
    expect(c.canReadTitles).toBe(false);
    expect(c.canReadIdle).toBe(true);
    expect(c.limitationNote).toMatch(/Wayland/);
  });

  it("unknown platform is fully degraded", () => {
    const c = resolveCapabilities({ platform: "aix" as NodeJS.Platform });
    expect(c.canIdentifyWindow).toBe(false);
    expect(c.canReadIdle).toBe(false);
  });
});
