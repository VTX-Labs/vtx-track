import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Tracker } from "../src/tracker.js";
import { FakeMonitor, tempStore, win, defaultConfig } from "./helpers.js";
import type { Store } from "@vtx-track/core";

let store: Store;
let cleanup: () => void;
let monitor: FakeMonitor;
let clock: number;
let tracker: Tracker;

beforeEach(() => {
  ({ store, cleanup } = tempStore());
  monitor = new FakeMonitor();
  clock = 1_000_000;
  tracker = new Tracker({
    monitor,
    store,
    config: { ...defaultConfig(), redaction: "full", heartbeatMs: 5000 },
    now: () => clock,
  });
});

afterEach(() => cleanup());

function advance(ms: number): void {
  clock += ms;
}

describe("Tracker", () => {
  it("records a segment when focus changes", () => {
    monitor.focus(win("Code", "a.ts"));
    tracker.start();
    advance(10_000);
    monitor.focus(win("chrome", "github"));
    const segs = store.segmentsBetween(0, clock + 1);
    expect(segs).toHaveLength(1);
    expect(segs[0]?.app).toBe("Code");
    expect(segs[0]?.durationMs).toBe(10_000);
    tracker.stop();
  });

  it("attributes time to the right category", () => {
    monitor.focus(win("Code", "a.ts"));
    tracker.start();
    advance(8_000);
    monitor.focus(win("Slack", "general"));
    const [seg] = store.segmentsBetween(0, clock + 1);
    expect(seg?.category).toBe("Coding");
    tracker.stop();
  });

  it("opens an idle gap when the user goes idle", () => {
    monitor.focus(win("Code", "a.ts"));
    tracker.start();
    advance(5_000);
    monitor.idle = { state: "idle", idleSeconds: 300, locked: false };
    tracker.tick(); // closes Code, opens idle gap
    advance(60_000);
    monitor.idle = { state: "active", idleSeconds: 0, locked: false };
    monitor.focus(win("Code", "a.ts"));
    const segs = store.segmentsBetween(0, clock + 1);
    const idleSeg = segs.find((s) => s.state === "idle");
    expect(idleSeg).toBeDefined();
    expect(idleSeg?.durationMs).toBe(60_000);
    tracker.stop();
  });

  it("records private gaps while paused", () => {
    monitor.focus(win("Code", "a.ts"));
    tracker.start();
    tracker.pause();
    advance(10_000);
    tracker.resume(); // closes the private gap
    const priv = store.segmentsBetween(0, clock + 1).find((s) => s.state === "private");
    expect(priv).toBeDefined();
    expect(priv?.app).toBe("private");
    tracker.stop();
  });

  it("attaches fresh vscode context and drops stale", () => {
    monitor.focus(win("Code", "a.ts", 4242));
    tracker.start();
    tracker.setVsCodeContext({
      pid: 4242,
      mode: "edit",
      activelyTyping: true,
      workspace: "vtx-track",
      branch: "main",
    });
    advance(6_000);
    monitor.focus(win("chrome", "x"));
    const [seg] = store.segmentsBetween(0, clock + 1);
    expect(seg?.vscode?.workspace).toBe("vtx-track");
    expect(seg?.vscode?.branch).toBe("main");
    tracker.stop();
  });

  it("groups VS Code time by project via summarize-able segments", () => {
    monitor.focus(win("Code", "a.ts", 1));
    tracker.start();
    tracker.setVsCodeContext({
      pid: 1,
      mode: "edit",
      activelyTyping: true,
      workspace: "projectA",
    });
    advance(30_000);
    // switch project
    tracker.setVsCodeContext({
      pid: 1,
      mode: "edit",
      activelyTyping: true,
      workspace: "projectB",
    });
    tracker.tick();
    advance(20_000);
    monitor.focus(win("chrome", "x"));
    const segs = store.segmentsBetween(0, clock + 1);
    const workspaces = segs.map((s) => s.vscode?.workspace).filter(Boolean);
    expect(workspaces).toContain("projectA");
    expect(workspaces).toContain("projectB");
    tracker.stop();
  });
});
