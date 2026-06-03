import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import type { PendingSegment } from "../src/sessionizer.js";

let dir: string;
let store: Store;

function pending(over: Partial<PendingSegment> = {}): PendingSegment {
  return {
    app: "Code",
    appExePath: "C:/Apps/Code.exe",
    category: "Coding",
    title: null,
    startedAt: 1000,
    endedAt: 61_000,
    durationMs: 60_000,
    state: "active",
    vscode: undefined,
    browser: undefined,
    ...over,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vtx-track-"));
  store = new Store(join(dir, "test.db"));
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("Store", () => {
  it("creates the schema and seeds categories", () => {
    const version = store.db.pragma("user_version", { simple: true });
    expect(version).toBe(1);
    const cats = store.db
      .prepare("SELECT COUNT(*) AS n FROM category")
      .get() as { n: number };
    expect(cats.n).toBeGreaterThan(5);
  });

  it("round-trips a basic segment", () => {
    const saved = store.insertSegment(pending());
    expect(saved.id).toBeGreaterThan(0);
    const rows = store.segmentsBetween(0, 100_000);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.app).toBe("Code");
    expect(rows[0]?.category).toBe("Coding");
    expect(rows[0]?.durationMs).toBe(60_000);
  });

  it("round-trips vscode context", () => {
    store.insertSegment(
      pending({
        vscode: {
          pid: 4242,
          mode: "edit",
          activelyTyping: true,
          workspace: "vtx-track",
          repo: "VTX-Labs/vtx-track",
          branch: "main",
          filePath: "src/index.ts",
          language: "typescript",
        },
      }),
    );
    const [row] = store.segmentsBetween(0, 100_000);
    expect(row?.vscode?.workspace).toBe("vtx-track");
    expect(row?.vscode?.branch).toBe("main");
    expect(row?.vscode?.language).toBe("typescript");
    expect(row?.vscode?.activelyTyping).toBe(true);
  });

  it("round-trips browser context", () => {
    store.insertSegment(
      pending({
        app: "chrome",
        category: "Browsing",
        browser: { pid: 5, domain: "github.com", tabTitle: "VTX-Labs" },
      }),
    );
    const [row] = store.segmentsBetween(0, 100_000);
    expect(row?.browser?.domain).toBe("github.com");
  });

  it("only returns segments overlapping the window", () => {
    store.insertSegment(pending({ startedAt: 0, endedAt: 1000 }));
    store.insertSegment(pending({ startedAt: 50_000, endedAt: 60_000 }));
    expect(store.segmentsBetween(40_000, 70_000)).toHaveLength(1);
  });

  it("wipes all data", () => {
    store.insertSegment(pending());
    store.insertSegment(pending());
    const deleted = store.wipe();
    expect(deleted).toBe(2);
    expect(store.segmentsBetween(0, 100_000)).toHaveLength(0);
  });

  it("reuses a stable host id across reopen", () => {
    const seg = store.insertSegment(pending());
    const host = seg.host;
    store.close();
    store = new Store(join(dir, "test.db"));
    const [row] = store.segmentsBetween(0, 100_000);
    expect(row?.host).toBe(host);
  });
});
