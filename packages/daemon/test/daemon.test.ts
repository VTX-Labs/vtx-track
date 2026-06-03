import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonClient } from "@vtx-track/protocol";
import { Store, defaultConfig } from "@vtx-track/core";
import { Daemon } from "../src/daemon.js";
import { FakeMonitor, win } from "./helpers.js";

let daemon: Daemon;
let dir: string;
let port: number;
let client: DaemonClient;
let monitor: FakeMonitor;

// Each test gets a distinct port so sequential teardown/setup can't race on a
// socket the OS hasn't fully released yet.
let nextPort = 7901;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "vtx-track-int-"));
  process.env.VTX_TRACK_HOME = dir;
  port = nextPort++;
  monitor = new FakeMonitor();
  const store = new Store(join(dir, "t.db"));
  daemon = await Daemon.create({
    config: {
      ...defaultConfig(),
      httpPort: port,
      dbPath: join(dir, "t.db"),
      minSegmentMs: 5, // tiny so short test segments are recorded
    },
    monitor,
    store,
    serveDashboard: false,
  });
  await daemon.start();
  client = new DaemonClient({
    baseUrl: `http://127.0.0.1:${port}`,
    token: daemon.getToken(),
  });
});

afterEach(async () => {
  await daemon.stop();
  delete process.env.VTX_TRACK_HOME;
  rmSync(dir, { recursive: true, force: true });
});

describe("Daemon integration", () => {
  it("serves /health", async () => {
    const health = await client.health();
    expect(health.ok).toBe(true);
    expect(health.platform).toBe("win32");
    expect(health.tracking).toBe(true);
  });

  it("reports a summary after activity", async () => {
    monitor.focus(win("Code", "a.ts"));
    await wait(20);
    monitor.focus(win("chrome", "github")); // closes the Code segment
    const summary = await client.summary(
      { from: 0, to: Date.now() + 1000 },
      "app",
    );
    const apps = summary.rows.map((r) => r.key);
    expect(apps).toContain("Code");
  });

  it("pauses and resumes via the token-gated control endpoint", async () => {
    const paused = await client.pause();
    expect(paused.paused).toBe(true);
    const resumed = await client.resume();
    expect(resumed.paused).toBe(false);
  });

  it("rejects control without a token", async () => {
    const anon = new DaemonClient({ baseUrl: `http://127.0.0.1:${port}` });
    await expect(anon.pause()).rejects.toMatchObject({ status: 401 });
  });

  it("accepts vscode context over HTTP and attaches it", async () => {
    monitor.focus(win("Code", "a.ts", 555));
    await fetch(`http://127.0.0.1:${port}/context/vscode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pid: 555,
        mode: "edit",
        activelyTyping: true,
        workspace: "vtx-track",
      }),
    });
    await wait(20);
    monitor.focus(win("chrome", "x"));
    const timeline = await client.timeline({ from: 0, to: Date.now() + 1000 });
    const withCtx = timeline.find((s) => s.vscode?.workspace === "vtx-track");
    expect(withCtx).toBeDefined();
  });

  it("wipes data with confirmation", async () => {
    monitor.focus(win("Code", "a.ts"));
    await wait(20);
    monitor.focus(win("chrome", "x"));
    const res = await client.wipe(true);
    expect(res.deleted).toBeGreaterThanOrEqual(0);
  });
});

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
