import { readFileSync } from "node:fs";
import { tokenPath } from "@vtx-track/core";

/** Read the daemon control token from disk, or null if it doesn't exist yet. */
export function readToken(path = tokenPath()): string | null {
  try {
    const t = readFileSync(path, "utf8").trim();
    return t.length > 0 ? t : null;
  } catch {
    return null;
  }
}
