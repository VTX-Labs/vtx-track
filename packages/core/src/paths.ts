import { homedir } from "node:os";
import { join } from "node:path";

/** Root directory for all vtx-track local state (`~/.vtx-track`). */
export function dataDir(): string {
  return process.env.VTX_TRACK_HOME ?? join(homedir(), ".vtx-track");
}

/** Default SQLite database path. */
export function defaultDbPath(): string {
  return join(dataDir(), "vtx-track.db");
}

/** Path to the JSON config file. */
export function configPath(): string {
  return join(dataDir(), "config.json");
}

/** Path to the local HTTP control token. */
export function tokenPath(): string {
  return join(dataDir(), "token");
}

/** Path to the IPC unix socket (non-Windows). On Windows a named pipe is used. */
export function socketPath(): string {
  if (process.platform === "win32") return "\\\\.\\pipe\\vtx-track";
  return join(dataDir(), "daemon.sock");
}

/** Path to the daemon's pid file. */
export function pidPath(): string {
  return join(dataDir(), "daemon.pid");
}

/** Path to the daemon log file. */
export function logPath(): string {
  return join(dataDir(), "daemon.log");
}
