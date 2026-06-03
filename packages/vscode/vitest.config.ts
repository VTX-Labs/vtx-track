import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      // Only the pure helpers are unit-tested; extension.ts/client.ts couple to
      // the `vscode` runtime module, which does not exist outside the host.
      include: ["src/derive.ts"],
    },
  },
});
