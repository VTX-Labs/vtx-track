import { createRequire } from "node:module";
import { logPath } from "@vtx-track/core";
import { SERVICE_LABEL, type ServiceSpec } from "./types.js";

/**
 * Resolve the daemon entry script path. The daemon package ships
 * `dist/main.js`; we resolve it from `@vtx-track/daemon`'s package root so the
 * service points at the installed daemon regardless of layout.
 */
export function resolveDaemonPath(): string {
  const require = createRequire(import.meta.url);
  // The daemon's package.json "bin" maps vtx-track-daemon → dist/main.js.
  // Resolve the package directory and append the known entry.
  try {
    const pkgJson = require.resolve("@vtx-track/daemon/package.json");
    return pkgJson.replace(/package\.json$/, "dist/main.js");
  } catch {
    // Fallback: a globally installed bin on PATH.
    return "vtx-track-daemon";
  }
}

/** Build the full service spec for the current install. */
export function serviceSpec(): ServiceSpec {
  return {
    nodePath: process.execPath,
    daemonPath: resolveDaemonPath(),
    logPath: logPath(),
    label: SERVICE_LABEL,
  };
}
