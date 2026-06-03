#!/usr/bin/env node
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { pidPath } from "@vtx-track/core";
import { Daemon } from "./daemon.js";
import { VERSION } from "./version.js";

/**
 * Entry point for the background daemon. Writes a pid file, starts the daemon,
 * and shuts down cleanly on SIGINT/SIGTERM. Intended to be launched by the OS
 * service manager (`@vtx-track/service`) but also runnable directly.
 */
async function main(): Promise<void> {
  const pid = pidPath();
  mkdirSync(dirname(pid), { recursive: true });
  writeFileSync(pid, String(process.pid), "utf8");

  const daemon = await Daemon.create();
  const { httpPort } = await daemon.start();
  process.stdout.write(
    `vtx-track daemon ${VERSION} listening on http://127.0.0.1:${httpPort}\n`,
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write(`\nvtx-track daemon stopping (${signal})…\n`);
    await daemon.stop();
    try {
      rmSync(pid, { force: true });
    } catch {
      /* ignore */
    }
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  // Windows service stop arrives as a message on some hosts.
  process.on("message", (msg) => {
    if (msg === "shutdown") void shutdown("message");
  });
}

main().catch((err) => {
  process.stderr.write(`vtx-track daemon failed to start: ${err?.stack ?? err}\n`);
  process.exit(1);
});
