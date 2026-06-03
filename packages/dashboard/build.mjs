// Builds the browser bundle and copies static assets into dist/public.
//
// Run AFTER tsup (which compiles the Node server entry to dist/ and cleans dist
// first). This step:
//   1. bundles src/app.ts (plus uPlot) into dist/public/app.js
//   2. copies public/index.html and public/styles.css into dist/public
//   3. copies uPlot's CSS into dist/public/uplot.css
import { build } from "esbuild";
import { cp, mkdir, copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const publicSrc = resolve(here, "public");
const publicOut = resolve(here, "dist", "public");
const require = createRequire(import.meta.url);

await mkdir(publicOut, { recursive: true });

// 1) Browser bundle: app.ts + uPlot, minified, ES2020, IIFE so it runs as a
//    plain module script with no import map.
await build({
  entryPoints: [resolve(here, "src", "app.ts")],
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2020",
  platform: "browser",
  outfile: resolve(publicOut, "app.js"),
  sourcemap: false,
  legalComments: "none",
});

// 2) Static shell + styles.
await copyFile(resolve(publicSrc, "index.html"), resolve(publicOut, "index.html"));
await copyFile(resolve(publicSrc, "styles.css"), resolve(publicOut, "styles.css"));

// 3) uPlot's stylesheet (resolved from the installed package).
const uplotCss = require.resolve("uplot/dist/uPlot.min.css");
await copyFile(uplotCss, resolve(publicOut, "uplot.css"));

// Copy any other public/* assets (favicons, etc.) if present, ignoring the two
// we already handled.
await cp(publicSrc, publicOut, {
  recursive: true,
  force: true,
  filter: (src) =>
    !src.endsWith("index.html") && !src.endsWith("styles.css"),
});

console.log("dashboard: built dist/public (app.js, index.html, styles.css, uplot.css)");
