import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", main: "src/main.ts" },
  format: ["esm"],
  target: "node20",
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
});
