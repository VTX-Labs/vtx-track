// @ts-check
/**
 * Build script for the vtx-track browser extension.
 *
 * Bundles the three entry points (background service worker, popup, options)
 * from `src/*.ts` into `dist/*.js` with esbuild, then copies the static assets
 * (manifest + HTML pages, and icons if present) into `dist/` so the folder can
 * be loaded unpacked directly.
 */
import { build } from "esbuild";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");

/** Entry points → output basenames (all land directly in dist/). */
const ENTRY_POINTS = {
  background: join(root, "src", "background.ts"),
  popup: join(root, "src", "popup.ts"),
  options: join(root, "src", "options.ts"),
};

/** Static files copied verbatim into dist/. */
const STATIC_FILES = ["manifest.json", "popup.html", "options.html"];

async function main() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });

  await build({
    entryPoints: ENTRY_POINTS,
    outdir: dist,
    bundle: true,
    format: "esm",
    target: "chrome111",
    platform: "browser",
    sourcemap: true,
    logLevel: "info",
  });

  for (const file of STATIC_FILES) {
    await cp(join(root, file), join(dist, file));
  }

  // Copy icons/ if the developer has supplied real PNGs (they are optional;
  // the README documents that the manifest references placeholders).
  const icons = join(root, "icons");
  if (existsSync(icons)) {
    const entries = await readdir(icons);
    if (entries.length > 0) {
      await cp(icons, join(dist, "icons"), { recursive: true });
    }
  }

  console.log("[vtx-track] extension built → dist/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
