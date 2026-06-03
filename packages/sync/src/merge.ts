import type { Segment } from "@vtx-track/protocol";

/**
 * Merge segments from multiple machines into one timeline. Segments are keyed
 * by `(host, startedAt, app)` so re-syncing the same machine is idempotent and
 * two machines' timelines interleave without duplication. Later pushes of the
 * same key win (last-write-wins on identical keys), which handles a segment
 * being re-sent after a local edit.
 */
export function mergeSegments(...sources: Segment[][]): Segment[] {
  const byKey = new Map<string, Segment>();
  for (const source of sources) {
    for (const seg of source) {
      byKey.set(keyOf(seg), seg);
    }
  }
  return [...byKey.values()].sort((a, b) => a.startedAt - b.startedAt);
}

/** Stable identity of a segment across syncs. */
export function keyOf(seg: Segment): string {
  return `${seg.host}|${seg.startedAt}|${seg.app}`;
}

/**
 * Detect overlaps between two machines (the same wall-clock window active on
 * both). Useful to warn that totals across machines may double-count if the
 * user really was on two machines at once. Returns total overlapping ms.
 */
export function overlapMs(a: Segment[], b: Segment[]): number {
  let total = 0;
  for (const x of a) {
    for (const y of b) {
      const start = Math.max(x.startedAt, y.startedAt);
      const end = Math.min(x.endedAt, y.endedAt);
      if (end > start) total += end - start;
    }
  }
  return total;
}
