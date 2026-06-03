#!/usr/bin/env node
import { join } from "node:path";
import { homedir } from "node:os";
import { createSyncServer } from "./server.js";

/**
 * Run a self-hosted sync server. Configure via environment:
 *   VTX_SYNC_TOKEN  — shared bearer token (required)
 *   VTX_SYNC_PORT   — listen port (default 7843)
 *   VTX_SYNC_STORE  — store file path (default ~/.vtx-track/sync-store.json)
 *
 * The server holds only ciphertext; it never sees your passphrase or data.
 */
function main(): void {
  const token = process.env.VTX_SYNC_TOKEN;
  if (!token) {
    process.stderr.write(
      "VTX_SYNC_TOKEN is required. Set a long random shared token and re-run.\n",
    );
    process.exit(1);
  }
  const port = Number(process.env.VTX_SYNC_PORT) || 7843;
  const storePath =
    process.env.VTX_SYNC_STORE ??
    join(homedir(), ".vtx-track", "sync-store.json");

  const server = createSyncServer({ token, storePath });
  server.listen(port, () => {
    process.stdout.write(`vtx-track sync server listening on :${port}\n`);
  });

  const shutdown = (): void => {
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
