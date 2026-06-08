#!/usr/bin/env node
/**
 * Best-effort postinstall for @vtx-track/daemon.
 *
 * When this package is installed on its own (e.g. `npm i -g @vtx-track/cli`
 * pulls it in), this pre-warms the SQLite native binding so the first
 * `vtx-track start` is instant. It is intentionally non-fatal: if scripts are
 * disabled, or the binding can't be fetched here, the daemon fetches it lazily
 * at startup anyway (see src/native-ensure.ts). Never blocks the install.
 */
try {
  const { ensureSqliteBinding } = await import("./dist/index.js");
  const ok = await ensureSqliteBinding((m) => process.stdout.write(`${m}\n`));
  if (!ok) {
    process.stdout.write(
      "[vtx-track] SQLite binding not prepared now; the daemon will fetch it " +
        "on first start.\n",
    );
  }
} catch {
  // dist not built yet (e.g. in a source checkout before build) or any other
  // issue — the runtime self-heal covers it. Stay silent and succeed.
}
process.exit(0);
