#!/usr/bin/env node
/**
 * Ensures native addon binaries are present after install. Run from the
 * workspace-root `postinstall` hook.
 *
 * The real work lives in `native-bootstrap.mjs`, which is shared with the
 * daemon's runtime self-heal so the app still works when this hook is skipped
 * (pnpm blocks dependency scripts, and `ignore-scripts=true` disables this one
 * entirely). See that module for the fetch strategy.
 *
 * Idempotent: no-ops when the binaries already exist. Never fails the install —
 * a missing optional addon degrades gracefully, and a missing required addon is
 * re-fetched lazily by the daemon at startup.
 */
import { ensureAllNative } from "./native-bootstrap.mjs";

const log = (msg) => process.stdout.write(`${msg}\n`);

const results = await ensureAllNative(log);
const failedRequired = results.filter((r) => !r.ok && r.required);
const failedOptional = results.filter((r) => !r.ok && !r.required);

for (const r of results) {
  if (r.ok && r.reason !== "present") {
    log(`[vtx-track] ${r.name}: ready (${r.reason}).`);
  }
}

if (failedOptional.length) {
  log(
    `[vtx-track] optional addon(s) unavailable: ${failedOptional
      .map((r) => r.name)
      .join(", ")}. Window/idle detection will run in a degraded mode.`,
  );
}

if (failedRequired.length) {
  log(
    `[vtx-track] note: ${failedRequired
      .map((r) => r.name)
      .join(", ")} not prepared during install (scripts may be disabled). ` +
      "The daemon will fetch it automatically on first start.",
  );
}

// Always exit 0 — never block the install. The daemon self-heals at startup.
process.exit(0);
