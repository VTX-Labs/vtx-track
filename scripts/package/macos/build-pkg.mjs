#!/usr/bin/env node
/**
 * Build the vtx-track macOS installer (.pkg).
 *
 * Produces `dist-installers/vtx-track-<version>.pkg` that installs the staged
 * self-contained app under `/usr/local/vtx-track`, symlinks the CLIs into
 * `/usr/local/bin`, and runs a postinstall that registers the launchd service.
 *
 * **Runs on macOS** (needs `pkgbuild`). The prebuilt better-sqlite3 / paymo
 * binaries staged here are the macOS ones, so this must build on a macOS host
 * (CI's macos-latest) — it cannot be produced or verified from the Windows dev
 * box. Driven by .github/workflows/release.yml.
 */
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const stageApp = join(repoRoot, "dist-stage", "app");
const outDir = join(repoRoot, "dist-installers");
const version = JSON.parse(
  readFileSync(join(repoRoot, "package.json"), "utf8"),
).version;

const IDENTIFIER = "dev.vtxlabs.track";
const INSTALL_LOCATION = "/usr/local/vtx-track";

const log = (m) => process.stdout.write(`[pkg] ${m}\n`);
const run = (cmd, args, cwd = repoRoot) =>
  execFileSync(cmd, args, { cwd, stdio: "inherit" });

function ensureStage() {
  if (existsSync(join(stageApp, "STAGE.json"))) return;
  log("staging app…");
  run("node", ["scripts/package/stage.mjs"]);
}

// postinstall runs as root; it symlinks the CLIs and then enables the launchd
// agent for the installing console user (not root) so tracking attributes to
// the real session.
const POSTINSTALL = `#!/bin/sh
set -e
mkdir -p /usr/local/bin
ln -sf "${INSTALL_LOCATION}/app/bin/vtx-track" /usr/local/bin/vtx-track
ln -sf "${INSTALL_LOCATION}/app/bin/vtx-track-daemon" /usr/local/bin/vtx-track-daemon
ln -sf "${INSTALL_LOCATION}/app/bin/vtx-track-tray" /usr/local/bin/vtx-track-tray

CONSOLE_USER=$(stat -f "%Su" /dev/console 2>/dev/null || echo "")
if [ -n "$CONSOLE_USER" ] && [ "$CONSOLE_USER" != "root" ]; then
  USER_UID=$(id -u "$CONSOLE_USER")
  launchctl asuser "$USER_UID" sudo -u "$CONSOLE_USER" \\
    /usr/local/bin/vtx-track start >/dev/null 2>&1 || true
fi
exit 0
`;

function main() {
  ensureStage();
  const buildRoot = join(outDir, "pkg-root");
  const scriptsDir = join(outDir, "pkg-scripts");
  rmSync(buildRoot, { recursive: true, force: true });
  rmSync(scriptsDir, { recursive: true, force: true });

  // payload: INSTALL_LOCATION/app ← staged tree
  const payloadApp = join(buildRoot, INSTALL_LOCATION.replace(/^\//, ""), "app");
  mkdirSync(payloadApp, { recursive: true });
  // Exclude any bundled node-runtime/ (Windows-MSI-only); macOS uses system Node.
  cpSync(stageApp, payloadApp, {
    recursive: true,
    filter: (src) => !src.includes(`${join("app", "node-runtime")}`),
  });
  for (const b of ["vtx-track", "vtx-track-daemon", "vtx-track-tray"]) {
    const p = join(payloadApp, "bin", b);
    if (existsSync(p)) chmodSync(p, 0o755);
  }

  mkdirSync(scriptsDir, { recursive: true });
  writeFileSync(join(scriptsDir, "postinstall"), POSTINSTALL);
  chmodSync(join(scriptsDir, "postinstall"), 0o755);

  mkdirSync(outDir, { recursive: true });
  const pkg = join(outDir, `vtx-track-${version}.pkg`);
  log("running pkgbuild…");
  run("pkgbuild", [
    "--root",
    buildRoot,
    "--identifier",
    IDENTIFIER,
    "--version",
    version,
    "--scripts",
    scriptsDir,
    "--install-location",
    "/",
    pkg,
  ]);
  rmSync(buildRoot, { recursive: true, force: true });
  rmSync(scriptsDir, { recursive: true, force: true });
  log(`built ${pkg}`);
}

main();
