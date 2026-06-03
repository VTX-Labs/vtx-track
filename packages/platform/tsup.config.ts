import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  target: "node20",
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  // Native addons stay external so their prebuilt binaries resolve at runtime.
  external: ["@paymoapp/active-window", "@paymoapp/real-idle"],
});
