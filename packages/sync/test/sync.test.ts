import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Segment } from "@vtx-track/protocol";
import { seal, open } from "../src/crypto.js";
import { mergeSegments, keyOf, overlapMs } from "../src/merge.js";
import { createSyncServer } from "../src/server.js";
import { SyncClient } from "../src/client.js";

let id = 1;
function seg(host: string, startedAt: number, app = "Code"): Segment {
  return {
    id: id++,
    app,
    appExePath: "",
    category: "Coding",
    title: null,
    startedAt,
    endedAt: startedAt + 1000,
    durationMs: 1000,
    state: "active",
    host,
  };
}

describe("crypto", () => {
  it("seals and opens round-trip", () => {
    const env = seal({ hello: "world" }, "correct horse");
    expect(open(env, "correct horse")).toEqual({ hello: "world" });
  });

  it("fails to open with the wrong passphrase", () => {
    const env = seal({ secret: 1 }, "right");
    expect(() => open(env, "wrong")).toThrow();
  });

  it("detects tampering via the auth tag", () => {
    const env = seal({ a: 1 }, "pw");
    const tampered = { ...env, data: Buffer.from("zzzz").toString("base64") };
    expect(() => open(tampered, "pw")).toThrow();
  });
});

describe("merge", () => {
  it("dedups identical segments and sorts by start", () => {
    const a = [seg("m1", 2000), seg("m1", 1000)];
    const b = [seg("m1", 1000)]; // duplicate of one in `a`
    const merged = mergeSegments(a, b);
    expect(merged).toHaveLength(2);
    expect(merged[0]?.startedAt).toBe(1000);
  });

  it("interleaves two machines without dropping", () => {
    const merged = mergeSegments([seg("m1", 1000)], [seg("m2", 1500)]);
    expect(merged).toHaveLength(2);
  });

  it("keyOf is stable per (host, start, app)", () => {
    expect(keyOf(seg("m1", 1000, "Code"))).toBe("m1|1000|Code");
  });

  it("overlapMs measures concurrent time", () => {
    const a = [seg("m1", 1000)]; // 1000..2000
    const b = [seg("m2", 1500)]; // 1500..2500
    expect(overlapMs(a, b)).toBe(500);
  });
});

describe("client + server integration", () => {
  let dir: string;
  let port: number;
  let close: () => Promise<void>;

  afterEach(async () => {
    await close?.();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  async function startServer(token: string): Promise<void> {
    dir = mkdtempSync(join(tmpdir(), "vtx-sync-"));
    const server = createSyncServer({
      token,
      storePath: join(dir, "store.json"),
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    port = typeof addr === "object" && addr ? addr.port : 0;
    close = () => new Promise<void>((r) => server.close(() => r()));
  }

  it("pushes encrypted data and merges across devices", async () => {
    await startServer("shared-token");
    const base = `http://127.0.0.1:${port}`;

    const laptop = new SyncClient({
      serverUrl: base,
      token: "shared-token",
      passphrase: "pw",
      deviceId: "laptop",
    });
    const desktop = new SyncClient({
      serverUrl: base,
      token: "shared-token",
      passphrase: "pw",
      deviceId: "desktop",
    });

    await laptop.push([seg("laptop", 1000)]);
    await desktop.push([seg("desktop", 2000)]);

    // Desktop pulls everything else, merged with its own local segments.
    const merged = await desktop.pullMerged([seg("desktop", 2000)]);
    const hosts = merged.map((s) => s.host).sort();
    expect(hosts).toEqual(["desktop", "laptop"]);
  });

  it("rejects a wrong token", async () => {
    await startServer("right");
    const bad = new SyncClient({
      serverUrl: `http://127.0.0.1:${port}`,
      token: "wrong",
      passphrase: "pw",
      deviceId: "x",
    });
    await expect(bad.push([seg("x", 1)])).rejects.toThrow();
  });
});
