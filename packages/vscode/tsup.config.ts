import { defineConfig } from "tsup";

// VS Code loads extensions as CommonJS, so we bundle to a single CJS file and
// mark `vscode` external (the host provides it at runtime). Source stays ESM;
// tsup down-compiles it.
export default defineConfig({
  entry: { extension: "src/extension.ts" },
  format: ["cjs"],
  target: "node20",
  external: ["vscode"],
  dts: false,
  clean: true,
  sourcemap: true,
  splitting: false,
});
