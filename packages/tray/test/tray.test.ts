import { describe, expect, it } from "vitest";
import { Tray, buildMenuItems, type TrayDaemon } from "../src/index.js";

function fakeDaemon(overrides: Partial<TrayDaemon> = {}): TrayDaemon & {
  pauseCalls: number;
  resumeCalls: number;
} {
  const state = { paused: false };
  const d = {
    pauseCalls: 0,
    resumeCalls: 0,
    async health() {
      return {
        paused: state.paused,
        version: "0.1.0",
        platform: "win32",
        windowIdentificationLimited: false,
      };
    },
    async pause() {
      d.pauseCalls++;
      state.paused = true;
    },
    async resume() {
      d.resumeCalls++;
      state.paused = false;
    },
    ...overrides,
  };
  return d;
}

describe("buildMenuItems", () => {
  it("shows tracking + Pause when online and active", () => {
    const items = buildMenuItems({ online: true, paused: false });
    expect(items[0]!.title).toContain("tracking");
    expect(items[0]!.enabled).toBe(false);
    const toggle = items.find((i) => i.title.startsWith("Pause"));
    expect(toggle?.enabled).toBe(true);
  });

  it("shows paused + Resume when paused", () => {
    const items = buildMenuItems({ online: true, paused: true });
    expect(items[0]!.title).toContain("paused");
    expect(items.some((i) => i.title === "Resume tracking")).toBe(true);
  });

  it("shows offline and disables the toggle when daemon is down", () => {
    const items = buildMenuItems({ online: false, paused: false });
    expect(items[0]!.title).toContain("offline");
    const toggle = items.find((i) => i.title.startsWith("Pause"));
    expect(toggle?.enabled).toBe(false);
  });

  it("always offers Open dashboard and Quit", () => {
    const items = buildMenuItems({ online: false, paused: false });
    expect(items.some((i) => i.title === "Open dashboard")).toBe(true);
    expect(items.some((i) => i.title === "Quit tray")).toBe(true);
  });
});

describe("Tray click handling", () => {
  it("pauses the daemon when Pause clicked", async () => {
    const daemon = fakeDaemon();
    const tray = new Tray({ daemon, openUrl: () => {} });
    await tray.handleClick("Pause tracking");
    expect(daemon.pauseCalls).toBe(1);
  });

  it("resumes the daemon when Resume clicked", async () => {
    const daemon = fakeDaemon();
    const tray = new Tray({ daemon, openUrl: () => {} });
    await tray.handleClick("Resume tracking");
    expect(daemon.resumeCalls).toBe(1);
  });

  it("opens the dashboard URL when Open dashboard clicked", async () => {
    const daemon = fakeDaemon();
    const opened: string[] = [];
    const tray = new Tray({
      daemon,
      dashboardUrl: "http://127.0.0.1:7842/",
      openUrl: (u) => opened.push(u),
    });
    await tray.handleClick("Open dashboard");
    expect(opened).toEqual(["http://127.0.0.1:7842/"]);
  });

  it("swallows daemon errors on pause (offline)", async () => {
    const daemon = fakeDaemon({
      async pause() {
        throw new Error("offline");
      },
      async health() {
        throw new Error("offline");
      },
    });
    const tray = new Tray({ daemon, openUrl: () => {} });
    await expect(tray.handleClick("Pause tracking")).resolves.toBeUndefined();
  });
});
