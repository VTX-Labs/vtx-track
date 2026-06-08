#!/usr/bin/env node
/**
 * Build the vtx-track Windows installer (MSI) with WiX v4/v5.
 *
 * Pipeline:
 *   1. ensure the staged app exists (scripts/package/stage.mjs);
 *   2. bundle a pinned Node runtime into the stage so the installed app needs
 *      no system Node;
 *   3. harvest the staged file tree into a WiX component fragment;
 *   4. run `wix build` to produce dist-installers/vtx-track-<version>-x64.msi.
 *
 * Requires the WiX CLI (`dotnet tool install --global wix`) and a dotnet SDK.
 * Run on Windows. Driven in CI by .github/workflows/release.yml.
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const stageApp = join(repoRoot, "dist-stage", "app");
const outDir = join(repoRoot, "dist-installers");
const version = JSON.parse(
  readFileSync(join(repoRoot, "package.json"), "utf8"),
).version;

// Node runtime to bundle. Keep in lockstep with engines.node (>=20).
const NODE_VERSION = "20.18.1";
const NODE_ARCH = "win-x64";

function log(m) {
  process.stdout.write(`[msi] ${m}\n`);
}

function run(cmd, args, cwd = repoRoot) {
  execFileSync(cmd, args, { cwd, stdio: "inherit", shell: true });
}

/** Stage the app if it isn't already there. */
function ensureStage() {
  if (existsSync(join(stageApp, "STAGE.json"))) return;
  log("staging app…");
  run("node", ["scripts/package/stage.mjs"]);
}

/** Download and unpack a pinned Node runtime into the stage's node-runtime/. */
async function bundleNode() {
  const dest = join(stageApp, "node-runtime");
  if (existsSync(join(dest, "node.exe"))) return;
  mkdirSync(dest, { recursive: true });
  const file = `node-v${NODE_VERSION}-${NODE_ARCH}.zip`;
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${file}`;
  const tmp = join(tmpdir(), file);
  const extractDir = join(tmpdir(), `node-extract-${NODE_VERSION}`);
  log(`downloading Node ${NODE_VERSION}…`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`Node download failed: ${res.status}`);
  await pipeline(res.body, createWriteStream(tmp));
  // Use PowerShell's native zip support; system tar can't reliably pull one
  // file out of a .zip with --strip-components.
  rmSync(extractDir, { recursive: true, force: true });
  run("powershell", [
    "-NoProfile",
    "-Command",
    `Expand-Archive -Path '${tmp}' -DestinationPath '${extractDir}' -Force`,
  ]);
  const nodeExe = join(extractDir, `node-v${NODE_VERSION}-${NODE_ARCH}`, "node.exe");
  if (!existsSync(nodeExe)) throw new Error("node.exe not found in archive");
  cpSync(nodeExe, join(dest, "node.exe"));
  rmSync(tmp, { force: true });
  rmSync(extractDir, { recursive: true, force: true });
  // Rewrite launchers to use the bundled Node.
  rewriteLaunchersForBundledNode();
}

/** Point the .cmd launchers at the bundled Node runtime. */
function rewriteLaunchersForBundledNode() {
  const binDir = join(stageApp, "bin");
  const map = {
    "vtx-track.cmd": "@vtx-track\\cli\\dist\\cli.js",
    "vtx-track-daemon.cmd": "@vtx-track\\daemon\\dist\\main.js",
    "vtx-track-tray.cmd": "@vtx-track\\tray\\dist\\main.js",
  };
  for (const [name, entry] of Object.entries(map)) {
    writeFileSync(
      join(binDir, name),
      `@echo off\r\n"%~dp0..\\node-runtime\\node.exe" "%~dp0..\\node_modules\\${entry}" %*\r\n`,
    );
  }
}

async function main() {
  ensureStage();
  await bundleNode();
  mkdirSync(outDir, { recursive: true });
  const msi = join(outDir, `vtx-track-${version}-x64.msi`);
  log("running wix build…");
  // The .wxs harvests $(var.StageDir)\** automatically via the <Files> element.
  run("wix", [
    "build",
    join(here, "vtx-track.wxs"),
    "-d",
    `Version=${version}`,
    "-d",
    `StageDir=${stageApp}`,
    "-arch",
    "x64",
    "-o",
    msi,
  ]);
  log(`built ${msi}`);
}

main().catch((e) => {
  process.stderr.write(`[msi] failed: ${e?.stack ?? e}\n`);
  process.exit(1);
});
