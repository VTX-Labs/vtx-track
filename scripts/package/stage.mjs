#!/usr/bin/env node
/**
 * Stage a self-contained vtx-track app tree for packaging into an installer.
 *
 * The output (`dist-stage/app/`) contains everything the daemon, CLI and tray
 * need to run on a machine with **no Node toolchain and no pnpm**:
 *   - the built `dist/` of every runtime package, under a flat node_modules so
 *     bare `@vtx-track/*` and third-party imports resolve without pnpm symlinks;
 *   - the prebuilt native binaries (better-sqlite3, the paymo addons), already
 *     fetched into place;
 *   - the systray2 helper binaries;
 *   - small launcher scripts.
 *
 * It does NOT bundle Node itself — the per-OS installers add a pinned Node
 * runtime (or declare it as a dependency). Keeping Node out of this step makes
 * the stage tree OS-agnostic and lets each installer choose its Node strategy.
 *
 * Usage: node scripts/package/stage.mjs [outDir]
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const outDir = process.argv[2]
  ? join(repoRoot, process.argv[2])
  : join(repoRoot, "dist-stage");
const appDir = join(outDir, "app");
const modulesDir = join(appDir, "node_modules");

const isWindows = process.platform === "win32";

/** Runtime workspace packages to stage (in dependency order doesn't matter). */
const RUNTIME_PACKAGES = [
  "protocol",
  "core",
  "platform",
  "daemon",
  "service",
  "cli",
  "tray",
  "dashboard",
  "integrations",
  "sync",
];

/** Third-party runtime deps that must be copied into the flat node_modules. */
const VENDOR_DEPS = [
  "better-sqlite3",
  "bindings",
  "file-uri-to-path",
  "@paymoapp/active-window",
  "@paymoapp/real-idle",
  "systray2",
  "debug",
  "ms",
  "fs-extra",
  "graceful-fs",
  "jsonfile",
  "universalify",
];

function log(msg) {
  process.stdout.write(`[stage] ${msg}\n`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Resolve a package's install dir. We try Node resolution from several anchors
 * (covers hoisted/flat installs) and, failing that, scan pnpm's content-
 * addressed `.pnpm/<name>@<ver>/node_modules/<name>` store directly — that's
 * where transitive natives like `bindings` and the paymo addons actually live
 * under pnpm's strict layout.
 */
function resolveDep(name) {
  const anchors = [
    join(repoRoot, "packages", "core", "package.json"),
    join(repoRoot, "packages", "tray", "package.json"),
    join(repoRoot, "packages", "daemon", "package.json"),
    join(repoRoot, "package.json"),
  ];
  for (const anchor of anchors) {
    try {
      const require = createRequire(anchor);
      return dirname(require.resolve(`${name}/package.json`));
    } catch {
      /* try next anchor */
    }
  }
  // Fall back to scanning the pnpm store.
  const pnpmDir = join(repoRoot, "node_modules", ".pnpm");
  if (!existsSync(pnpmDir)) return null;
  // pnpm encodes "@scope/name" as "@scope+name" in the store dir name.
  const encoded = name.replace("/", "+");
  for (const entry of readdirSync(pnpmDir)) {
    if (entry === `${encoded}` || entry.startsWith(`${encoded}@`)) {
      const candidate = join(pnpmDir, entry, "node_modules", ...name.split("/"));
      if (existsSync(join(candidate, "package.json"))) return candidate;
    }
  }
  return null;
}

function ensureCleanOut() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(modulesDir, { recursive: true });
}

/** Build all packages and make sure native binaries are present. */
function buildAndFetch() {
  log("building workspace…");
  execFileSync(isWindows ? "pnpm.cmd" : "pnpm", ["build"], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: isWindows,
  });
  log("ensuring native binaries…");
  execFileSync("node", ["scripts/fetch-native.mjs"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
}

/** Copy a workspace package's publishable files into the flat node_modules. */
function stageWorkspacePackage(name) {
  const srcDir = join(repoRoot, "packages", name);
  const pkg = readJson(join(srcDir, "package.json"));
  const destDir = join(modulesDir, ...pkg.name.split("/"));
  mkdirSync(destDir, { recursive: true });

  // Copy dist + declared files (README/LICENSE/icons/etc.), and package.json.
  const files = new Set(["dist", "package.json", ...(pkg.files ?? [])]);
  for (const f of files) {
    const from = join(srcDir, f);
    if (existsSync(from)) cpSync(from, join(destDir, f), { recursive: true });
  }
  // Rewrite workspace:* deps to "*" so the flat layout resolves cleanly.
  const staged = readJson(join(destDir, "package.json"));
  for (const field of ["dependencies", "optionalDependencies"]) {
    if (!staged[field]) continue;
    for (const dep of Object.keys(staged[field])) {
      if (String(staged[field][dep]).startsWith("workspace:")) {
        staged[field][dep] = "*";
      }
    }
  }
  writeFileSync(
    join(destDir, "package.json"),
    JSON.stringify(staged, null, 2) + "\n",
  );
}

/** Copy a third-party dependency (with its native build/ output) verbatim. */
function stageVendorDep(name) {
  const dir = resolveDep(name);
  if (!dir) {
    log(`WARNING: vendor dep not found: ${name}`);
    return;
  }
  const destDir = join(modulesDir, ...name.split("/"));
  mkdirSync(dirname(destDir), { recursive: true });
  cpSync(dir, destDir, { recursive: true });
}

/** Write small launcher scripts for the daemon / cli / tray. */
function writeLaunchers() {
  const binDir = join(appDir, "bin");
  mkdirSync(binDir, { recursive: true });
  const entries = {
    "vtx-track": "@vtx-track/cli/dist/cli.js",
    "vtx-track-daemon": "@vtx-track/daemon/dist/main.js",
    "vtx-track-tray": "@vtx-track/tray/dist/main.js",
  };
  for (const [bin, entry] of Object.entries(entries)) {
    // POSIX launcher
    writeFileSync(
      join(binDir, bin),
      `#!/bin/sh\nexec node "$(dirname "$0")/../node_modules/${entry}" "$@"\n`,
      { mode: 0o755 },
    );
    // Windows launcher
    writeFileSync(
      join(binDir, `${bin}.cmd`),
      `@echo off\r\nnode "%~dp0..\\node_modules\\${entry.replace(/\//g, "\\")}" %*\r\n`,
    );
  }
}

function writeManifest() {
  const rootPkg = readJson(join(repoRoot, "package.json"));
  writeFileSync(
    join(appDir, "STAGE.json"),
    JSON.stringify(
      { name: "vtx-track", version: rootPkg.version, staged: true },
      null,
      2,
    ) + "\n",
  );
}

function main() {
  ensureCleanOut();
  buildAndFetch();
  log("staging workspace packages…");
  for (const p of RUNTIME_PACKAGES) stageWorkspacePackage(p);
  log("staging vendor dependencies…");
  for (const d of VENDOR_DEPS) stageVendorDep(d);
  writeLaunchers();
  writeManifest();
  log(`done → ${appDir}`);
}

main();
