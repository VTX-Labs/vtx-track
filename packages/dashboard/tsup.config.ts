import { defineConfig } from "tsup";

// Builds only the server entry (the Node static-file handler). The browser app
// (src/app.ts) is bundled separately by build.mjs with esbuild, because it pulls
// in uPlot and targets the DOM rather than Node.
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  target: "node20",
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
});
