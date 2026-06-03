import type { Segment } from "@vtx-track/protocol";

/**
 * A WakaTime-style heartbeat/duration record.
 *
 * Mirrors the public shape WakaTime's API and importers expect, but produced
 * entirely offline from local segments — no API key, no network.
 */
export interface WakatimeHeartbeat {
  /** The file (when known) or app being worked in. */
  entity: string;
  /** `"file"` when a VS Code file path is known, otherwise `"app"`. */
  type: "file" | "app";
  /** Project name, derived from the VS Code workspace or repo. */
  project: string | null;
  /** Programming language, when known. */
  language: string | null;
  /** VS Code git branch, when known. */
  branch: string | null;
  /** Segment start time, in epoch SECONDS (WakaTime convention). */
  time: number;
  /** How long the entity was worked on, in seconds. */
  duration: number;
  /** True when the user was actively typing in the editor. */
  is_write: boolean;
  /** Category bucket carried through from the segment. */
  category: string;
}

/**
 * Transform segments into WakaTime-style heartbeat records.
 *
 * Pure transform: the `entity` is the VS Code file path when available, else
 * the app name; `time` is the segment start in epoch seconds; `is_write` comes
 * from `vscode.activelyTyping`.
 */
export function toWakatimeHeartbeats(segments: Segment[]): WakatimeHeartbeat[] {
  return segments.map((seg) => {
    const filePath = seg.vscode?.filePath;
    const project = seg.vscode?.workspace ?? seg.vscode?.repo ?? null;
    return {
      entity: filePath ?? seg.app,
      type: filePath ? "file" : "app",
      project,
      language: seg.vscode?.language ?? null,
      branch: seg.vscode?.branch ?? null,
      time: Math.floor(seg.startedAt / 1000),
      duration: Math.round(seg.durationMs / 1000),
      is_write: seg.vscode?.activelyTyping ?? false,
      category: seg.category,
    };
  });
}
