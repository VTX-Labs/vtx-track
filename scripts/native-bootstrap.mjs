/**
 * Shared native-addon bootstrap for vtx-track.
 *
 * The daemon depends on three prebuilt native addons — `better-sqlite3` (the
 * SQLite store), `@paymoapp/active-window`, and `@paymoapp/real-idle`. Each one
 * ships prebuilt binaries, but they are normally wired up by a dependency
 * lifecycle script that pnpm (≥10) blocks by default — and that any user with
 * `ignore-scripts=true` in their npmrc (a common, sensible security setting)
 * disables entirely. When that happens the binaries never land and the daemon
 * dies at startup with a cryptic "Could not locate the bindings file" error.
 *
 * This module makes the bootstrap robust and self-healing. It is called from
 * two places:
 *   1. the workspace-root `postinstall` (best effort — skipped if scripts off);
 *   2. the daemon at startup, which lazily ensures the binaries exist before
 *      opening the store, so the app works even on a scripts-disabled install.
 *
 * Each addon is prepared in escalating steps, stopping at the first that
 * produces the binary:
 *   a. run the addon's own `prebuild-install` from its package dir (fast path);
 *   b. download the matching prebuilt tarball straight from GitHub Releases and
 *      extract it with the system `tar`. This works even when
 *      `prebuild-install`'s own deps weren't installed — the common
 *      pnpm-isolation failure — and even on toolchain-less machines where the
 *      source build (step c) can't run;
 *   c. compile from source via the addon's gyp script (last resort; needs a
 *      C/C++ toolchain).
 *
 * No third-party dependencies: it shells out to each addon's bundled
 * `prebuild-install`, to the system `tar`, and to `npm` for source builds.
 * Idempotent: every step no-ops when the target binary already exists.
 */
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";

const here = dirname(fileURLToPath(import.meta.url));
const isWindows = process.platform === "win32";

/** NODE_MODULE_VERSION (ABI) of the running Node, e.g. 127 for Node 22. */
const ABI = process.versions.modules;

/**
 * The native dependencies vtx-track relies on, and how to prepare each.
 *  - `binary`        path (under the package dir) whose presence means "ready".
 *  - `prebuildArgs`  args for the package's own `prebuild-install`.
 *  - `ghRelease`     GitHub release-asset descriptor used as a network fallback
 *                    when `prebuild-install` can't run.
 *  - `sourceScript`  npm script to compile from source if all downloads fail.
 *  - `required`      true if a missing binary is fatal (no graceful fallback).
 */
const NATIVE_DEPS = [
  {
    name: "better-sqlite3",
    binary: ["build", "Release", "better_sqlite3.node"],
    prebuildArgs: [],
    ghRelease: {
      repo: "WiseLibs/better-sqlite3",
      // e.g. better-sqlite3-v12.10.0-node-v127-win32-x64.tar.gz
      asset: (v) =>
        `better-sqlite3-v${v}-node-v${ABI}-${process.platform}-${process.arch}.tar.gz`,
    },
    sourceScript: "build-release",
    required: true,
  },
  {
    name: "@paymoapp/active-window",
    binary: ["build", "Release", "PaymoActiveWindow.node"],
    prebuildArgs: ["-r", "napi"],
    ghRelease: {
      repo: "paymo-org/node-active-window",
      // N-API addon: one binary per platform/arch, independent of Node ABI.
      // e.g. active-window-v2.1.4-napi-v6-win32-x64.tar.gz
      asset: (v) =>
        `active-window-v${v}-napi-v6-${process.platform}-${process.arch}.tar.gz`,
    },
    sourceScript: "build:gyp",
    required: false,
  },
  {
    name: "@paymoapp/real-idle",
    binary: ["build", "Release", "PaymoRealIdle.node"],
    prebuildArgs: ["-r", "napi"],
    ghRelease: {
      repo: "paymo-org/node-real-idle",
      // e.g. real-idle-v1.1.2-napi-v6-win32-x64.tar.gz
      asset: (v) =>
        `real-idle-v${v}-napi-v6-${process.platform}-${process.arch}.tar.gz`,
    },
    sourceScript: "build:gyp",
    required: false,
  },
];

/**
 * Resolve the install directory of a dependency. In a pnpm workspace the native
 * dep lives under its consuming package, so we resolve from a set of anchor
 * package.json files rather than just the workspace root.
 */
function packageDir(name) {
  const anchors = [
    join(here, "..", "packages", "core", "package.json"),
    join(here, "..", "packages", "platform", "package.json"),
    join(here, "..", "package.json"),
  ];
  for (const anchor of anchors) {
    try {
      const require = createRequire(anchor);
      return dirname(require.resolve(`${name}/package.json`));
    } catch {
      // try the next anchor
    }
  }
  return null;
}

/** Read a dependency's installed version from its package.json. */
function packageVersion(dir) {
  try {
    return createRequire(join(dir, "package.json"))("./package.json").version;
  } catch {
    return null;
  }
}

/** Run a command in `cwd`, using a shell on Windows so `.CMD` shims resolve. */
function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: "inherit", shell: isWindows });
}

/**
 * Extract a `.tar.gz` into `dest` using the system `tar`. The tarball lays out
 * `build/Release/<name>.node`, so extracting at `dest` lands it in place.
 *
 * Windows quirks are handled deliberately: GNU tar reads a `C:\…` path as a
 * remote `host:path`, so we copy the tarball into `dest`, run tar from there
 * referencing it by basename, pass `--force-local`, and invoke tar WITHOUT a
 * shell so backslashes in `dest` aren't double-escaped.
 */
function extractTarball(tarball, basename, dest) {
  if (isWindows) {
    const local = join(dest, basename);
    if (local !== tarball) copyFileSync(tarball, local);
    try {
      execFileSync("tar", ["--force-local", "-xzf", basename], {
        cwd: dest,
        stdio: "inherit",
        shell: false,
      });
    } finally {
      if (local !== tarball) rmSync(local, { force: true });
    }
  } else {
    execFileSync("tar", ["-xzf", tarball, "-C", dest], {
      stdio: "inherit",
      shell: false,
    });
  }
}

/** Step (a): the addon's own `prebuild-install`. Returns true on success. */
function tryPrebuildInstall(dep, dir, binary, log) {
  const prebuildBin = join(
    dir,
    "node_modules",
    ".bin",
    isWindows ? "prebuild-install.CMD" : "prebuild-install",
  );
  if (!existsSync(prebuildBin)) return false;
  try {
    log("  → prebuild-install");
    run(prebuildBin, dep.prebuildArgs, dir);
  } catch (e) {
    log(`    prebuild-install failed: ${e?.message ?? e}`);
  }
  return existsSync(binary);
}

/**
 * Step (b): download the prebuilt tarball directly from GitHub Releases and
 * extract it into the package with the system `tar`. The tarball lays out
 * `build/Release/<name>.node`, so extracting at the package root lands the
 * binary in the right place. Works when `prebuild-install`'s own deps weren't
 * installed (the common pnpm-isolation failure). Returns true on success.
 */
async function tryGithubRelease(dep, dir, binary, version, log) {
  if (!dep.ghRelease || !version) return false;
  const asset = dep.ghRelease.asset(version);
  const url = `https://github.com/${dep.ghRelease.repo}/releases/download/v${version}/${asset}`;

  const tmp = mkdtempSync(join(tmpdir(), "vtx-native-"));
  const tarball = join(tmp, asset);
  try {
    log(`  → download ${dep.ghRelease.repo} v${version}`);
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok || !res.body) {
      log(`    no release asset (${res.status})`);
      return false;
    }
    await pipeline(res.body, createWriteStream(tarball));
    // System tar exists on Windows 10+, macOS and Linux. On Windows, GNU tar
    // treats a path with a drive-letter colon (C:\…) as a remote host, so we
    // run tar from the destination dir and reference the tarball by basename
    // with `--force-local`, avoiding any colon-bearing path arg. We also call
    // tar without a shell on Windows so backslashes aren't double-escaped.
    extractTarball(tarball, asset, dir);
    return existsSync(binary);
  } catch (e) {
    log(`    release download failed: ${e?.message ?? e}`);
    return false;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Step (c): compile from source via the addon's gyp script. */
function trySourceBuild(dep, dir, binary, log) {
  if (!dep.sourceScript) return false;
  try {
    log(`  → compile from source (${dep.sourceScript})`);
    run(isWindows ? "npm.cmd" : "npm", ["run", dep.sourceScript], dir);
  } catch (e) {
    log(`    source build failed: ${e?.message ?? e}`);
  }
  return existsSync(binary);
}

/**
 * Ensure a single native dependency's binary is present. Returns
 * `{ name, ok, required, reason }`. Never throws.
 */
export async function ensureNativeDep(dep, log = () => {}) {
  const dir = packageDir(dep.name);
  if (!dir) {
    return { name: dep.name, ok: false, required: dep.required, reason: "not installed" };
  }

  const binary = join(dir, ...dep.binary);
  if (existsSync(binary)) {
    return { name: dep.name, ok: true, required: dep.required, reason: "present" };
  }

  const version = packageVersion(dir);
  log(`[vtx-track] preparing ${dep.name}@${version ?? "?"}…`);

  if (tryPrebuildInstall(dep, dir, binary, log)) {
    return { name: dep.name, ok: true, required: dep.required, reason: "prebuild-install" };
  }
  if (await tryGithubRelease(dep, dir, binary, version, log)) {
    return { name: dep.name, ok: true, required: dep.required, reason: "github-release" };
  }
  if (trySourceBuild(dep, dir, binary, log)) {
    return { name: dep.name, ok: true, required: dep.required, reason: "source" };
  }
  return { name: dep.name, ok: false, required: dep.required, reason: "all strategies failed" };
}

/**
 * Ensure every native dependency is present. Returns the per-dep results so
 * callers can decide how to react (warn vs. fail). Never throws.
 */
export async function ensureAllNative(log = () => {}) {
  const results = [];
  for (const dep of NATIVE_DEPS) {
    try {
      results.push(await ensureNativeDep(dep, log));
    } catch (err) {
      results.push({
        name: dep.name,
        ok: false,
        required: dep.required,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

/** True once `better-sqlite3`'s binary is present (the daemon's hard dep). */
export function sqliteReady() {
  const dep = NATIVE_DEPS[0];
  const dir = packageDir(dep.name);
  return dir != null && existsSync(join(dir, ...dep.binary));
}

/** Convenience: ensure just better-sqlite3 (the daemon's blocking dep). */
export function ensureSqlite(log = () => {}) {
  return ensureNativeDep(NATIVE_DEPS[0], log);
}

// `node scripts/native-bootstrap.mjs --list` prints resolution status.
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1] &&
  process.argv.includes("--list")
) {
  for (const dep of NATIVE_DEPS) {
    const dir = packageDir(dep.name);
    const ready = dir && existsSync(join(dir, ...dep.binary));
    // eslint-disable-next-line no-console
    console.log(`${ready ? "OK " : "-- "} ${dep.name} (${dir ?? "not installed"})`);
  }
}
