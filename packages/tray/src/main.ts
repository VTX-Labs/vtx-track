#!/usr/bin/env node
import { Tray } from "./tray.js";

/**
 * Entry point for the tray companion (`vtx-track-tray`). Spawns the tray icon
 * and keeps the process alive until the user quits it or the OS tears it down.
 * The tray is a thin remote control: closing it never stops tracking.
 */
async function main(): Promise<void> {
  const tray = new Tray();
  await tray.start();

  const shutdown = async (): Promise<void> => {
    await tray.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  process.stderr.write(`vtx-track tray failed to start: ${err?.stack ?? err}\n`);
  process.exit(1);
});
