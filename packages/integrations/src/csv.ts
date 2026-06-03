import { fmtDuration } from "@vtx-track/core";
import type { Segment, TimesheetReport } from "@vtx-track/protocol";

/**
 * Quote a single CSV field per RFC 4180: wrap in double quotes and double any
 * embedded quotes when the value contains a comma, quote, or newline.
 */
function quoteField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Join a row of already-stringified values into a single CSV line. */
function row(fields: Array<string | number | null>): string {
  return fields
    .map((f) => quoteField(f === null ? "" : String(f)))
    .join(",");
}

const SEGMENT_HEADER = [
  "id",
  "app",
  "category",
  "title",
  "startedAt",
  "endedAt",
  "durationMs",
  "state",
  "project",
  "language",
  "branch",
] as const;

/**
 * Render segments as a CSV document (header row + one row per segment).
 *
 * Timestamps are emitted as ISO-8601 strings; project/language/branch are
 * pulled from the VS Code context when present.
 */
export function toCsv(segments: Segment[]): string {
  const lines: string[] = [row([...SEGMENT_HEADER])];
  for (const seg of segments) {
    lines.push(
      row([
        seg.id,
        seg.app,
        seg.category,
        seg.title,
        new Date(seg.startedAt).toISOString(),
        new Date(seg.endedAt).toISOString(),
        seg.durationMs,
        seg.state,
        seg.vscode?.workspace ?? seg.vscode?.repo ?? null,
        seg.vscode?.language ?? null,
        seg.vscode?.branch ?? null,
      ]),
    );
  }
  return lines.join("\n");
}

/**
 * Render a timesheet report as a CSV document. Includes a human-readable
 * duration column alongside raw milliseconds and billable hours.
 */
export function toTimesheetCsv(report: TimesheetReport): string {
  const lines: string[] = [
    row(["key", "durationMs", "duration", "hours"]),
  ];
  for (const r of report.rows) {
    lines.push(row([r.key, r.durationMs, fmtDuration(r.durationMs), r.hours]));
  }
  lines.push(row(["TOTAL", "", "", report.totalHours]));
  return lines.join("\n");
}
