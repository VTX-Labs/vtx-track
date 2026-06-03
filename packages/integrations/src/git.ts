import type { Segment } from "@vtx-track/protocol";

/**
 * Attribute total time (in milliseconds) to git branches, keyed by
 * `vscode.branch`. Segments without a branch are ignored.
 */
export function attributeToBranches(segments: Segment[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const seg of segments) {
    const branch = seg.vscode?.branch;
    if (branch === undefined) continue;
    totals.set(branch, (totals.get(branch) ?? 0) + seg.durationMs);
  }
  return totals;
}

/**
 * Attribute total time (in milliseconds) to git repositories. Prefers
 * `vscode.repo`, falling back to `vscode.workspace`. Segments with neither are
 * ignored.
 */
export function attributeToRepos(segments: Segment[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const seg of segments) {
    const repo = seg.vscode?.repo ?? seg.vscode?.workspace;
    if (repo === undefined) continue;
    totals.set(repo, (totals.get(repo) ?? 0) + seg.durationMs);
  }
  return totals;
}
