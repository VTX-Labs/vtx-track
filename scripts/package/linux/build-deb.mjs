#!/usr/bin/env node
/**
 * Build the vtx-track Debian package (.deb).
 *
 * Produces `dist-installers/vtx-track_<version>_amd64.deb` containing the staged
 * self-contained app under `/opt/vtx-track`, with symlinks in `/usr/bin` and a
 * postinst that registers the per-user systemd service on first login.
 *
 * **Runs on Linux** (needs `dpkg-deb`, present on Debian/Ubuntu and CI's
 * ubuntu-latest). The prebuilt better-sqlite3 / paymo binaries staged here are
 * the Linux ones, so this must build on a Linux host — it can't be produced or
 * verified from the Windows dev box. Driven by .github/workflows/release.yml.
 */
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
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

const log = (m) => process.stdout.write(`[deb] ${m}\n`);
const run = (cmd, args, cwd = repoRoot) =>
  execFileSync(cmd, args, { cwd, stdio: "inherit" });

function ensureStage() {
  if (existsSync(join(stageApp, "STAGE.json"))) return;
  log("staging app…");
  run("node", ["scripts/package/stage.mjs"]);
}

const CONTROL = (v) => `Package: vtx-track
Version: ${v}
Section: utils
Priority: optional
Architecture: amd64
Depends: nodejs (>= 20)
Maintainer: VTX Labs <hello@vtxlabs.dev>
Homepage: https://github.com/VTX-Labs/vtx-track
Description: Local-first, privacy-first time tracker for your whole machine.
 vtx-track records how you spend time across apps, projects, files, languages
 and git branches, with deep VS Code granularity. A headless background daemon
 keeps all data on your machine in SQLite; a CLI, web dashboard and tray give
 you reports and control. No cloud, no account, no telemetry.
`;

// Register the per-user service on install. Runs as root at package install
// time, so it can't enable a --user unit directly; instead it drops a profile.d
// hook that starts tracking on each user's first interactive login.
const POSTINST = `#!/bin/sh
set -e
ln -sf /opt/vtx-track/app/bin/vtx-track /usr/bin/vtx-track
ln -sf /opt/vtx-track/app/bin/vtx-track-daemon /usr/bin/vtx-track-daemon
ln -sf /opt/vtx-track/app/bin/vtx-track-tray /usr/bin/vtx-track-tray
cat > /etc/profile.d/vtx-track.sh <<'EOF'
# Start vtx-track tracking on first interactive login (idempotent).
if [ -n "$PS1" ] && command -v vtx-track >/dev/null 2>&1; then
  vtx-track status >/dev/null 2>&1 || vtx-track start >/dev/null 2>&1 || true
fi
EOF
chmod 0644 /etc/profile.d/vtx-track.sh
exit 0
`;

const PRERM = `#!/bin/sh
set -e
# Best-effort stop for the invoking user; per-user units can't be removed as root.
if [ -n "$SUDO_USER" ]; then
  su - "$SUDO_USER" -c 'vtx-track uninstall >/dev/null 2>&1 || true' || true
fi
rm -f /usr/bin/vtx-track /usr/bin/vtx-track-daemon /usr/bin/vtx-track-tray
rm -f /etc/profile.d/vtx-track.sh
exit 0
`;

function main() {
  ensureStage();
  const root = join(outDir, "deb-root");
  rmSync(root, { recursive: true, force: true });

  // /opt/vtx-track/app ← staged tree. Exclude any bundled node-runtime/ — that
  // is the Windows MSI's private Node; the deb declares `Depends: nodejs`.
  const optApp = join(root, "opt", "vtx-track", "app");
  mkdirSync(optApp, { recursive: true });
  cpSync(stageApp, optApp, {
    recursive: true,
    filter: (src) => !src.includes(`${join("app", "node-runtime")}`),
  });

  // POSIX launchers must be executable.
  for (const b of ["vtx-track", "vtx-track-daemon", "vtx-track-tray"]) {
    const p = join(optApp, "bin", b);
    if (existsSync(p)) chmodSync(p, 0o755);
  }

  // DEBIAN control dir
  const debianDir = join(root, "DEBIAN");
  mkdirSync(debianDir, { recursive: true });
  writeFileSync(join(debianDir, "control"), CONTROL(version));
  writeFileSync(join(debianDir, "postinst"), POSTINST);
  writeFileSync(join(debianDir, "prerm"), PRERM);
  chmodSync(join(debianDir, "postinst"), 0o755);
  chmodSync(join(debianDir, "prerm"), 0o755);

  mkdirSync(outDir, { recursive: true });
  const deb = join(outDir, `vtx-track_${version}_amd64.deb`);
  log("running dpkg-deb…");
  run("dpkg-deb", ["--build", "--root-owner-group", root, deb]);
  rmSync(root, { recursive: true, force: true });
  log(`built ${deb}`);
}

// Symlink helper retained for clarity even though postinst does the linking.
void symlinkSync;

main();
