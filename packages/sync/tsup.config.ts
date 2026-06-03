import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", "server-main": "src/server-main.ts" },
  format: ["esm"],
  target: "node20",
  dts: { entry: { index: "src/index.ts" } },
  clean: true,
  sourcemap: true,
  splitting: false,
});
