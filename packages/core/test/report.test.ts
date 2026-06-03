import { describe, expect, it } from "vitest";
import {
  summarize,
  focusMetrics,
  standup,
  timesheet,
  fmtDuration,
} from "../src/report.js";
import type { Segment } from "@vtx-track/protocol";

let nextId = 1;
function seg(
  app: string,
  category: string,
  durationMs: number,
  state: Segment["state"] = "active",
  vscode?: Segment["vscode"],
): Segment {
  const startedAt = nextId * 1_000_000;
  return {
    id: nextId++,
    app,
    appExePath: "",
    category,
    title: null,
    startedAt,
    endedAt: startedAt + durationMs,
    durationMs,
    state,
    host: "test",
    ...(vscode ? { vscode } : {}),
  };
}

describe("summarize", () => {
  it("groups by app and computes shares", () => {
    const r = summarize(
      [seg("Code", "Coding", 60_000), seg("chrome", "Browsing", 40_000)],
      0,
      100,
      "app",
    );
    expect(r.totalMs).toBe(100_000);
    expect(r.rows[0]?.key).toBe("Code");
    expect(r.rows[0]?.share).toBeCloseTo(0.6);
  });

  it("excludes idle/locked from totals", () => {
    const r = summarize(
      [seg("Code", "Coding", 60_000), seg("Code", "Coding", 999, "idle")],
      0,
      100,
      "app",
    );
    expect(r.totalMs).toBe(60_000);
  });

  it("separates active from idlePrevented", () => {
    const r = summarize(
      [
        seg("zoom", "Meetings", 30_000, "idlePrevented"),
        seg("Code", "Coding", 30_000, "active"),
      ],
      0,
      100,
      "category",
    );
    const meetings = r.rows.find((x) => x.key === "Meetings");
    expect(meetings?.durationMs).toBe(30_000);
    expect(meetings?.activeMs).toBe(0); // idlePrevented is not "active"
  });

  it("groups by project from vscode context", () => {
    const r = summarize(
      [
        seg("Code", "Coding", 60_000, "active", {
          pid: 1,
          mode: "edit",
          activelyTyping: true,
          workspace: "vtx-track",
        }),
      ],
      0,
      100,
      "project",
    );
    expect(r.rows[0]?.key).toBe("vtx-track");
  });
});

describe("focusMetrics", () => {
  it("counts context switches", () => {
    const r = focusMetrics(
      [
        seg("Code", "Coding", 60_000),
        seg("chrome", "Browsing", 60_000),
        seg("Code", "Coding", 60_000),
      ],
      "2026-06-03",
    );
    expect(r.contextSwitches).toBe(2);
    expect(r.totalActiveMs).toBe(180_000);
  });

  it("detects deep-work sessions", () => {
    const r = focusMetrics(
      [seg("Code", "Coding", 30 * 60_000)],
      "2026-06-03",
    );
    expect(r.deepWorkSessions).toBe(1);
    expect(r.longestDeepWorkMs).toBe(30 * 60_000);
  });
});

describe("standup + timesheet", () => {
  it("produces markdown referencing projects", () => {
    const r = standup(
      [
        seg("Code", "Coding", 90 * 60_000, "active", {
          pid: 1,
          mode: "edit",
          activelyTyping: true,
          workspace: "vtx-track",
          branch: "main",
        }),
      ],
      "2026-06-03",
    );
    expect(r.markdown).toContain("vtx-track");
    expect(r.markdown).toContain("main");
    expect(r.projects[0]?.branches).toContain("main");
  });

  it("computes billable hours", () => {
    const r = timesheet(
      [seg("Code", "Coding", 3_600_000)],
      0,
      100,
      "category",
    );
    expect(r.totalHours).toBe(1);
    expect(r.rows[0]?.hours).toBe(1);
  });
});

describe("fmtDuration", () => {
  it("formats compactly", () => {
    expect(fmtDuration(0)).toBe("0m");
    expect(fmtDuration(60_000)).toBe("1m");
    expect(fmtDuration(3_600_000)).toBe("1h 0m");
    expect(fmtDuration(8_040_000)).toBe("2h 14m");
  });
});
