import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  target: "node20",
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  // better-sqlite3 is a native addon; keep it external so its prebuilt binary
  // resolves at runtime from the consumer's node_modules.
  external: ["better-sqlite3"],
});
