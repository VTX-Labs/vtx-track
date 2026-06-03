import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { tokenPath } from "@vtx-track/core";

/**
 * Read the local control token, creating it on first use. The token gates
 * control endpoints (pause/config/wipe) so that other localhost processes can't
 * mutate tracking. The file is written `0600` (owner-only) where supported.
 */
export function ensureToken(path = tokenPath()): string {
  try {
    const existing = readFileSync(path, "utf8").trim();
    if (existing.length >= 32) return existing;
  } catch {
    // not created yet
  }
  const token = randomBytes(32).toString("hex");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, token + "\n", { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // chmod is a no-op / unsupported on some Windows filesystems
  }
  return token;
}

/** Read the token without creating it; returns null if absent. */
export function readToken(path = tokenPath()): string | null {
  try {
    const t = readFileSync(path, "utf8").trim();
    return t.length > 0 ? t : null;
  } catch {
    return null;
  }
}
