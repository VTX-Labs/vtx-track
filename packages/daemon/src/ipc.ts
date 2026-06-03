import { createServer, type Server, type Socket } from "node:net";
import { existsSync, unlinkSync } from "node:fs";
import type { VsCodeContext, BrowserContext } from "@vtx-track/protocol";
import { socketPath } from "@vtx-track/core";
import type { Tracker } from "./tracker.js";

/**
 * A newline-delimited JSON request handled over the IPC socket. Same-user
 * processes on the socket are trusted (the named pipe / unix socket perms gate
 * access), so no token is required here — it's the low-latency path for the
 * VS Code extension and CLI.
 */
type IpcRequest =
  | { type: "vscode"; context: VsCodeContext }
  | { type: "browser"; context: BrowserContext }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "ping" };

export interface IpcDeps {
  tracker: Tracker;
}

/**
 * Create the IPC server. On Windows this is a named pipe; elsewhere a unix
 * domain socket. Each line a client writes is one JSON request; the server
 * replies with one JSON line.
 */
export function createIpcServer(deps: IpcDeps): Server {
  const path = socketPath();
  // Clean up a stale unix socket from a previous run.
  if (process.platform !== "win32" && existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      /* ignore */
    }
  }

  const server = createServer((socket) => handleConnection(socket, deps));
  return server;
}

/** The socket path the IPC server listens on. */
export function ipcPath(): string {
  return socketPath();
}

function handleConnection(socket: Socket, deps: IpcDeps): void {
  socket.setEncoding("utf8");
  let buffer = "";
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const reply = dispatch(line, deps);
      socket.write(JSON.stringify(reply) + "\n");
      newline = buffer.indexOf("\n");
    }
  });
  socket.on("error", () => {
    /* client disconnected; ignore */
  });
}

function dispatch(line: string, deps: IpcDeps): { ok: boolean; error?: string } {
  let req: IpcRequest;
  try {
    req = JSON.parse(line) as IpcRequest;
  } catch {
    return { ok: false, error: "invalid json" };
  }
  switch (req.type) {
    case "vscode":
      deps.tracker.setVsCodeContext(req.context);
      return { ok: true };
    case "browser":
      deps.tracker.setBrowserContext(req.context);
      return { ok: true };
    case "pause":
      deps.tracker.pause();
      return { ok: true };
    case "resume":
      deps.tracker.resume();
      return { ok: true };
    case "ping":
      return { ok: true };
    default:
      return { ok: false, error: "unknown request" };
  }
}
