import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "src/cli.ts" },
  format: ["esm"],
  target: "node20",
  dts: false,
  clean: true,
  sourcemap: true,
  splitting: false,
  // The shebang at the top of src/cli.ts is preserved so dist/cli.js runs directly.
});
