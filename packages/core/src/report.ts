import type {
  FocusReport,
  GroupBy,
  Segment,
  StandupReport,
  SummaryReport,
  TimesheetReport,
} from "@vtx-track/protocol";

/** States that count as the user genuinely spending time on an app. */
const PRODUCTIVE_STATES = new Set(["active", "idlePrevented"]);
/** States that count toward "active" (the productivity numerator). */
const ACTIVE_STATES = new Set(["active"]);

const HOUR_MS = 3_600_000;
const DEEP_WORK_MS = 25 * 60_000;

/** Extract the grouping key for a segment under a given dimension. */
function keyOf(seg: Segment, by: GroupBy): string | null {
  switch (by) {
    case "app":
      return seg.app;
    case "category":
      return seg.category;
    case "project":
      return seg.vscode?.workspace ?? seg.vscode?.repo ?? null;
    case "language":
      return seg.vscode?.language ?? null;
    case "branch":
      return seg.vscode?.branch ?? null;
  }
}

/** Build a grouped summary over segments. Idle/locked/private gaps are excluded. */
export function summarize(
  segments: Segment[],
  from: number,
  to: number,
  by: GroupBy,
): SummaryReport {
  const totals = new Map<string, { durationMs: number; activeMs: number }>();
  let totalMs = 0;

  for (const seg of segments) {
    if (!PRODUCTIVE_STATES.has(seg.state)) continue;
    const key = keyOf(seg, by);
    if (key === null) continue;
    const bucket = totals.get(key) ?? { durationMs: 0, activeMs: 0 };
    bucket.durationMs += seg.durationMs;
    if (ACTIVE_STATES.has(seg.state)) bucket.activeMs += seg.durationMs;
    totals.set(key, bucket);
    totalMs += seg.durationMs;
  }

  const rows = [...totals.entries()]
    .map(([key, v]) => ({
      key,
      durationMs: v.durationMs,
      activeMs: v.activeMs,
      share: totalMs > 0 ? v.durationMs / totalMs : 0,
    }))
    .sort((a, b) => b.durationMs - a.durationMs);

  return { from, to, groupBy: by, totalMs, rows };
}

/** Compute focus / context-switching metrics for a set of segments (one day). */
export function focusMetrics(segments: Segment[], date: string): FocusReport {
  const productive = segments.filter((s) => PRODUCTIVE_STATES.has(s.state));
  const totalActiveMs = productive.reduce((n, s) => n + s.durationMs, 0);

  let contextSwitches = 0;
  let prevApp: string | null = null;
  for (const seg of productive) {
    if (prevApp !== null && seg.app !== prevApp) contextSwitches++;
    prevApp = seg.app;
  }

  // Deep-work spans: consecutive productive segments on the same project/app
  // with no idle gap between them.
  let longest = 0;
  let deepWorkSessions = 0;
  let runMs = 0;
  let runKey: string | null = null;
  const flush = () => {
    if (runMs >= DEEP_WORK_MS) deepWorkSessions++;
    if (runMs > longest) longest = runMs;
    runMs = 0;
  };
  for (const seg of segments) {
    if (!PRODUCTIVE_STATES.has(seg.state)) {
      flush();
      runKey = null;
      continue;
    }
    const key = seg.vscode?.workspace ?? seg.app;
    if (key !== runKey && runKey !== null) flush();
    runKey = key;
    runMs += seg.durationMs;
  }
  flush();

  const activeHours = totalActiveMs / HOUR_MS;
  return {
    date,
    totalActiveMs,
    contextSwitches,
    switchesPerHour: activeHours > 0 ? contextSwitches / activeHours : 0,
    longestDeepWorkMs: longest,
    deepWorkSessions,
  };
}

/** Generate a human-readable standup summary for a day. */
export function standup(segments: Segment[], date: string): StandupReport {
  const byProject = summarize(segments, 0, 0, "project").rows;
  const byCategory = summarize(segments, 0, 0, "category").rows;
  const totalActiveMs = byCategory.reduce((n, r) => n + r.durationMs, 0);

  // Collect branches touched per project.
  const branchesByProject = new Map<string, Set<string>>();
  for (const seg of segments) {
    const proj = seg.vscode?.workspace ?? seg.vscode?.repo;
    if (proj && seg.vscode?.branch) {
      const set = branchesByProject.get(proj) ?? new Set();
      set.add(seg.vscode.branch);
      branchesByProject.set(proj, set);
    }
  }

  const projects = byProject.map((r) => ({
    project: r.key,
    durationMs: r.durationMs,
    branches: [...(branchesByProject.get(r.key) ?? [])],
  }));

  const lines: string[] = [`**Standup — ${date}**`, ""];
  lines.push(`Total focused time: ${fmtDuration(totalActiveMs)}`, "");
  if (projects.length > 0) {
    lines.push("Worked on:");
    for (const p of projects) {
      const branchNote =
        p.branches.length > 0 ? ` (${p.branches.join(", ")})` : "";
      lines.push(`- ${p.project}: ${fmtDuration(p.durationMs)}${branchNote}`);
    }
  } else {
    lines.push("_No project-attributed time recorded._");
  }

  return { date, totalActiveMs, markdown: lines.join("\n"), projects };
}

/** Build a billable timesheet rollup. */
export function timesheet(
  segments: Segment[],
  from: number,
  to: number,
  by: GroupBy,
): TimesheetReport {
  const summary = summarize(segments, from, to, by);
  const rows = summary.rows.map((r) => ({
    key: r.key,
    durationMs: r.durationMs,
    hours: round2(r.durationMs / HOUR_MS),
  }));
  return {
    from,
    to,
    groupBy: by,
    rows,
    totalHours: round2(summary.totalMs / HOUR_MS),
  };
}

/** Format a duration in ms as a compact human string, e.g. "2h 14m". */
export function fmtDuration(ms: number): string {
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
