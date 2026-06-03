import { describe, expect, it } from "vitest";
import type { Segment, TimesheetReport } from "@vtx-track/protocol";
import { toWakatimeHeartbeats } from "../src/wakatime.js";
import { toTogglEntries } from "../src/toggl.js";
import { toClockifyEntries } from "../src/clockify.js";
import { toCsv, toTimesheetCsv } from "../src/csv.js";
import { toJson, fromJson, MalformedSegmentError } from "../src/json.js";
import { attributeToBranches, attributeToRepos } from "../src/git.js";

let nextId = 1;
function seg(
  app: string,
  category: string,
  durationMs: number,
  state: Segment["state"] = "active",
  vscode?: Segment["vscode"],
  title: string | null = null,
): Segment {
  const startedAt = nextId * 1_000_000;
  return {
    id: nextId++,
    app,
    appExePath: "",
    category,
    title,
    startedAt,
    endedAt: startedAt + durationMs,
    durationMs,
    state,
    host: "test",
    ...(vscode ? { vscode } : {}),
  };
}

describe("toWakatimeHeartbeats", () => {
  it("emits a file entity with epoch-seconds time and is_write", () => {
    const s = seg("Code", "Coding", 60_000, "active", {
      pid: 1,
      mode: "edit",
      activelyTyping: true,
      workspace: "vtx-track",
      filePath: "src/index.ts",
      language: "typescript",
      branch: "main",
    });
    const [hb] = toWakatimeHeartbeats([s]);
    expect(hb?.entity).toBe("src/index.ts");
    expect(hb?.type).toBe("file");
    expect(hb?.project).toBe("vtx-track");
    expect(hb?.language).toBe("typescript");
    expect(hb?.branch).toBe("main");
    expect(hb?.is_write).toBe(true);
    expect(hb?.time).toBe(Math.floor(s.startedAt / 1000));
    expect(hb?.duration).toBe(60);
  });

  it("falls back to app entity when there is no file", () => {
    const [hb] = toWakatimeHeartbeats([seg("chrome", "Browsing", 30_000)]);
    expect(hb?.entity).toBe("chrome");
    expect(hb?.type).toBe("app");
    expect(hb?.project).toBeNull();
    expect(hb?.is_write).toBe(false);
  });
});

describe("toTogglEntries", () => {
  it("produces ISO start/stop and seconds duration", () => {
    const [e] = toTogglEntries([
      seg("Code", "Coding", 3_600_000, "active", undefined, "editing"),
    ]);
    expect(e?.description).toBe("editing");
    expect(e?.duration).toBe(3600);
    expect(e?.tags).toEqual(["Coding"]);
    expect(new Date(e?.start ?? "").toISOString()).toBe(e?.start);
  });

  it("merges consecutive same-project segments", () => {
    const vs = (ws: string): Segment["vscode"] => ({
      pid: 1,
      mode: "edit",
      activelyTyping: true,
      workspace: ws,
    });
    const entries = toTogglEntries([
      seg("Code", "Coding", 1000, "active", vs("a")),
      seg("Code", "Coding", 2000, "active", vs("a")),
      seg("Code", "Coding", 4000, "active", vs("b")),
    ]);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.project).toBe("a");
    expect(entries[0]?.duration).toBe(3); // 3000ms merged
    expect(entries[1]?.project).toBe("b");
    expect(entries[1]?.duration).toBe(4);
  });
});

describe("toClockifyEntries", () => {
  it("produces clockify shape and merges by project", () => {
    const vs = (ws: string): Segment["vscode"] => ({
      pid: 1,
      mode: "edit",
      activelyTyping: false,
      workspace: ws,
    });
    const entries = toClockifyEntries([
      seg("Code", "Coding", 5000, "active", vs("proj")),
      seg("Code", "Coding", 5000, "active", vs("proj")),
    ]);
    expect(entries).toHaveLength(1);
    const e = entries[0];
    expect(e?.project).toBe("proj");
    expect(e?.durationSeconds).toBe(10);
    expect(e?.billable).toBe(false);
    expect(e?.tags).toEqual(["Coding"]);
    expect(new Date(e?.end ?? "").toISOString()).toBe(e?.end);
  });
});

describe("toCsv", () => {
  it("emits a header and a row per segment", () => {
    const csv = toCsv([seg("Code", "Coding", 1000)]);
    const lines = csv.split("\n");
    expect(lines[0]).toContain("id,app,category,title");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("Code");
  });

  it("quotes fields containing commas, quotes, and newlines", () => {
    const csv = toCsv([
      seg("Code", "Coding", 1000, "active", undefined, 'a, "b"\nc'),
    ]);
    const dataLine = csv.split("\n").slice(1).join("\n");
    expect(dataLine).toContain('"a, ""b""\nc"');
  });

  it("renders a timesheet CSV with totals", () => {
    const report: TimesheetReport = {
      from: 0,
      to: 100,
      groupBy: "category",
      rows: [{ key: "Coding", durationMs: 3_600_000, hours: 1 }],
      totalHours: 1,
    };
    const csv = toTimesheetCsv(report);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("key,durationMs,duration,hours");
    expect(lines[1]).toContain("Coding");
    expect(lines[1]).toContain("1h 0m");
    expect(lines[lines.length - 1]).toContain("TOTAL");
  });
});

describe("toJson / fromJson", () => {
  it("round-trips segments", () => {
    const original = [
      seg("Code", "Coding", 1000, "active", {
        pid: 7,
        mode: "edit",
        activelyTyping: true,
        workspace: "vtx-track",
        branch: "main",
      }),
      seg("chrome", "Browsing", 2000, "idle"),
    ];
    const parsed = fromJson(toJson(original));
    expect(parsed).toEqual(original);
  });

  it("throws on non-JSON input", () => {
    expect(() => fromJson("{not json")).toThrow(MalformedSegmentError);
  });

  it("throws when the top level is not an array", () => {
    expect(() => fromJson('{"id":1}')).toThrow(MalformedSegmentError);
  });

  it("throws when a required field is missing or wrong type", () => {
    expect(() => fromJson('[{"id":"oops"}]')).toThrow(MalformedSegmentError);
  });

  it("throws on an invalid activity state", () => {
    const bad = JSON.stringify([
      {
        id: 1,
        app: "Code",
        appExePath: "",
        category: "Coding",
        title: null,
        startedAt: 0,
        endedAt: 1,
        durationMs: 1,
        state: "bogus",
        host: "test",
      },
    ]);
    expect(() => fromJson(bad)).toThrow(/invalid state/);
  });

  it("validates nested vscode context", () => {
    const bad = JSON.stringify([
      {
        id: 1,
        app: "Code",
        appExePath: "",
        category: "Coding",
        title: null,
        startedAt: 0,
        endedAt: 1,
        durationMs: 1,
        state: "active",
        host: "test",
        vscode: { pid: 1, mode: "flying", activelyTyping: true },
      },
    ]);
    expect(() => fromJson(bad)).toThrow(/invalid mode/);
  });
});

describe("git attribution", () => {
  it("sums ms per branch and ignores branchless segments", () => {
    const onBranch = (b: string): Segment["vscode"] => ({
      pid: 1,
      mode: "edit",
      activelyTyping: true,
      branch: b,
    });
    const m = attributeToBranches([
      seg("Code", "Coding", 1000, "active", onBranch("main")),
      seg("Code", "Coding", 2000, "active", onBranch("main")),
      seg("Code", "Coding", 5000, "active", onBranch("feat")),
      seg("chrome", "Browsing", 9000),
    ]);
    expect(m.get("main")).toBe(3000);
    expect(m.get("feat")).toBe(5000);
    expect(m.size).toBe(2);
  });

  it("attributes to repos, falling back to workspace", () => {
    const m = attributeToRepos([
      seg("Code", "Coding", 1000, "active", {
        pid: 1,
        mode: "edit",
        activelyTyping: true,
        repo: "vtx-track",
      }),
      seg("Code", "Coding", 2000, "active", {
        pid: 1,
        mode: "edit",
        activelyTyping: true,
        workspace: "fallback-ws",
      }),
    ]);
    expect(m.get("vtx-track")).toBe(1000);
    expect(m.get("fallback-ws")).toBe(2000);
  });
});
