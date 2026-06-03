import type { Segment } from "@vtx-track/protocol";

/** A Toggl-style time entry, as accepted by Toggl's import/CSV tooling. */
export interface TogglEntry {
  /** Human-readable description (the merged window title or app name). */
  description: string;
  /** Project name, derived from the VS Code workspace/repo, or null. */
  project: string | null;
  /** ISO-8601 start timestamp. */
  start: string;
  /** ISO-8601 stop timestamp. */
  stop: string;
  /** Total duration in seconds. */
  duration: number;
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
 * Transform segments into Toggl time entries, merging runs of consecutive
 * segments that share the same project into a single entry.
 *
 * Merging keys on `project` only; the description and tags are taken from the
 * first segment in each run and the run's span is start..stop of the run.
 */
export function toTogglEntries(segments: Segment[]): TogglEntry[] {
  const entries: TogglEntry[] = [];
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
      stop: new Date(run.endedAt).toISOString(),
      duration: Math.round(run.durationMs / 1000),
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
