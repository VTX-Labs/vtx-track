import type { Segment } from "@vtx-track/protocol";

/**
 * A Clockify-style time entry, matching the column shape Clockify's CSV/API
 * importers expect.
 */
export interface ClockifyEntry {
  /** Entry description (the window title or app name). */
  description: string;
  /** Project name, derived from the VS Code workspace/repo, or null. */
  project: string | null;
  /** ISO-8601 start timestamp. */
  start: string;
  /** ISO-8601 end timestamp. */
  end: string;
  /** Total duration in seconds. */
  durationSeconds: number;
  /** Whether the entry is billable. Defaults to false for local exports. */
  billable: boolean;
  /** Tags — the segment category. */
  tags: string[];
}

/** Resolve a stable project label for grouping/merging consecutive segments. */
function projectOf(seg: Segment): string | null {
  return seg.vscode?.workspace ?? seg.vscode?.repo ?? null;
}

/** Resolve a human description for a segment. */
function descriptionOf(seg: Segment): string {
  return seg.title ?? seg.app;
}

/**
 * Transform segments into Clockify time entries, merging runs of consecutive
 * segments that share the same project into a single entry.
 */
export function toClockifyEntries(segments: Segment[]): ClockifyEntry[] {
  const entries: ClockifyEntry[] = [];
  let run: {
    project: string | null;
    description: string;
    category: string;
    startedAt: number;
    endedAt: number;
    durationMs: number;
  } | null = null;

  const flush = (): void => {
    if (run === null) return;
    entries.push({
      description: run.description,
      project: run.project,
      start: new Date(run.startedAt).toISOString(),
      end: new Date(run.endedAt).toISOString(),
      durationSeconds: Math.round(run.durationMs / 1000),
      billable: false,
      tags: [run.category],
    });
    run = null;
  };

  for (const seg of segments) {
    const project = projectOf(seg);
    if (run !== null && run.project === project) {
      run.endedAt = seg.endedAt;
      run.durationMs += seg.durationMs;
      continue;
    }
    flush();
    run = {
      project,
      description: descriptionOf(seg),
      category: seg.category,
      startedAt: seg.startedAt,
      endedAt: seg.endedAt,
      durationMs: seg.durationMs,
    };
  }
  flush();

  return entries;
}
