import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", main: "src/main.ts" },
  format: ["esm"],
  target: "node20",
  dts: { entry: { index: "src/index.ts" } },
  clean: true,
  sourcemap: true,
  splitting: false,
  external: ["better-sqlite3", "@paymoapp/active-window", "@paymoapp/real-idle"],
});
