#!/usr/bin/env node
/**
 * Ensures native addon binaries are present after install.
 *
 * pnpm (≥10) blocks dependency lifecycle scripts by default, and
 * `better-sqlite3` ships its binary via `prebuild-install`, which therefore
 * never runs on a fresh `pnpm install`. Rather than whitelist arbitrary
 * dependency build scripts, we explicitly fetch the prebuilt binary here from
 * the workspace root's (trusted) postinstall hook. If a prebuilt binary isn't
 * available for this platform/ABI, we fall back to compiling from source.
 *
 * This is idempotent: it no-ops when the binary already exists.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the install directory of a dependency. In a pnpm workspace the native
 * dep lives under the consuming package, so we resolve from `@vtx-track/core`'s
 * directory rather than the workspace root.
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

const isWindows = process.platform === "win32";

/** Run a command in `cwd`, using a shell on Windows so `.CMD` shims resolve. */
function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: "inherit", shell: isWindows });
}

/**
 * The native dependencies vtx-track relies on, and how each one is prepared.
 * `binary` is the file whose presence means "already built".
 * `prebuildArgs` are passed to the package's own `prebuild-install`.
 * `sourceScript`, when set, is an npm script to run if no prebuild is found.
 */
const NATIVE_DEPS = [
  {
    name: "better-sqlite3",
    binary: ["build", "Release", "better_sqlite3.node"],
    prebuildArgs: [],
    sourceScript: "build-release",
  },
  {
    name: "@paymoapp/active-window",
    binary: ["build", "Release", "PaymoActiveWindow.node"],
    prebuildArgs: ["-r", "napi"],
    sourceScript: "build:gyp",
  },
  {
    name: "@paymoapp/real-idle",
    binary: ["build", "Release", "PaymoRealIdle.node"],
    prebuildArgs: ["-r", "napi"],
    sourceScript: "build:gyp",
  },
];

function ensureNative(dep) {
  const dir = packageDir(dep.name);
  if (!dir) {
    console.warn(`[vtx-track] ${dep.name} not installed yet; skipping.`);
    return;
  }
  const binary = join(dir, ...dep.binary);
  if (existsSync(binary)) return; // already built

  const prebuildBin = join(
    dir,
    "node_modules",
    ".bin",
    isWindows ? "prebuild-install.CMD" : "prebuild-install",
  );

  try {
    if (existsSync(prebuildBin)) {
      console.log(`[vtx-track] fetching ${dep.name} prebuilt binary…`);
      run(prebuildBin, dep.prebuildArgs, dir);
    }
  } catch {
    // prebuild not available for this platform/ABI — fall back to source build.
  }

  if (existsSync(binary)) return;

  if (dep.sourceScript) {
    console.log(`[vtx-track] compiling ${dep.name} from source…`);
    run(isWindows ? "npm.cmd" : "npm", ["run", dep.sourceScript], dir);
  }
}

let failed = false;
for (const dep of NATIVE_DEPS) {
  try {
    ensureNative(dep);
  } catch (err) {
    failed = true;
    console.error(
      `[vtx-track] failed to prepare ${dep.name}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

if (failed) {
  console.error(
    "[vtx-track] one or more native binaries could not be prepared. App " +
      "tracking may run in a degraded mode. You may need a C/C++ toolchain; " +
      "see README → Troubleshooting.",
  );
}
