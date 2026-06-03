import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  DEFAULT_HEARTBEAT_MS,
  DEFAULT_HTTP_PORT,
  DEFAULT_IDLE_THRESHOLD_SECONDS,
  DEFAULT_MIN_SEGMENT_MS,
  type Config,
} from "@vtx-track/protocol";
import { configPath, defaultDbPath } from "./paths.js";

/** The configuration vtx-track ships with before any user customization. */
export function defaultConfig(): Config {
  return {
    httpPort: DEFAULT_HTTP_PORT,
    idleThresholdSeconds: DEFAULT_IDLE_THRESHOLD_SECONDS,
    heartbeatMs: DEFAULT_HEARTBEAT_MS,
    minSegmentMs: DEFAULT_MIN_SEGMENT_MS,
    denylist: [],
    redaction: "apps-only",
    redactionPatterns: [],
    categoryRules: [],
    goals: {},
    dbPath: defaultDbPath(),
  };
}

/**
 * Load config from disk, filling any missing keys from {@link defaultConfig}.
 * A malformed or absent file yields the defaults rather than throwing — the
 * daemon must always be able to start.
 */
export function loadConfig(path = configPath()): Config {
  const base = defaultConfig();
  let parsed: Partial<Config> = {};
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<Config>;
  } catch {
    return base;
  }
  return mergeConfig(base, parsed);
}

/** Merge a partial config over a base, validating types defensively. */
export function mergeConfig(base: Config, patch: Partial<Config>): Config {
  return {
    httpPort: numberOr(patch.httpPort, base.httpPort),
    idleThresholdSeconds: numberOr(
      patch.idleThresholdSeconds,
      base.idleThresholdSeconds,
    ),
    heartbeatMs: numberOr(patch.heartbeatMs, base.heartbeatMs),
    minSegmentMs: numberOr(patch.minSegmentMs, base.minSegmentMs),
    denylist: Array.isArray(patch.denylist) ? patch.denylist : base.denylist,
    redaction: patch.redaction ?? base.redaction,
    redactionPatterns: Array.isArray(patch.redactionPatterns)
      ? patch.redactionPatterns
      : base.redactionPatterns,
    categoryRules: Array.isArray(patch.categoryRules)
      ? patch.categoryRules
      : base.categoryRules,
    goals:
      patch.goals && typeof patch.goals === "object"
        ? patch.goals
        : base.goals,
    dbPath: patch.dbPath ?? base.dbPath,
  };
}

/** Persist config to disk, creating the data directory if needed. */
export function saveConfig(config: Config, path = configPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", "utf8");
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
