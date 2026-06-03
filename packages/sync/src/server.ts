import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { SealedEnvelope } from "./crypto.js";

/**
 * A deliberately dumb sync server. It stores one opaque {@link SealedEnvelope}
 * per device id and hands them back; it cannot read any of them (everything is
 * encrypted client-side). Authentication is a shared bearer token you set when
 * you run your own instance — the server never sees your passphrase.
 */
export interface SyncServerOptions {
  /** Shared bearer token required on every request. */
  token: string;
  /** Path to the JSON store file. */
  storePath: string;
}

interface StoreShape {
  devices: Record<string, SealedEnvelope>;
}

export function createSyncServer(opts: SyncServerOptions): Server {
  const store = loadStore(opts.storePath);

  return createServer((req, res) => {
    handle(req, res, opts, store).catch(() => {
      json(res, 500, { error: "internal" });
    });
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  opts: SyncServerOptions,
  store: StoreShape,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const method = req.method ?? "GET";

  if (url.pathname === "/health") {
    json(res, 200, { ok: true, devices: Object.keys(store.devices).length });
    return;
  }

  if (req.headers.authorization !== `Bearer ${opts.token}`) {
    json(res, 401, { error: "unauthorized" });
    return;
  }

  // GET /devices → list of device ids that have data.
  if (url.pathname === "/devices" && method === "GET") {
    json(res, 200, { devices: Object.keys(store.devices) });
    return;
  }

  // GET /device/:id → the sealed envelope for a device.
  const match = url.pathname.match(/^\/device\/([\w.-]+)$/);
  if (match) {
    const id = match[1] as string;
    if (method === "GET") {
      const env = store.devices[id];
      if (!env) {
        json(res, 404, { error: "not found" });
        return;
      }
      json(res, 200, env);
      return;
    }
    if (method === "PUT") {
      const body = (await readBody(req)) as SealedEnvelope | null;
      if (!isEnvelope(body)) {
        json(res, 400, { error: "invalid envelope" });
        return;
      }
      store.devices[id] = body;
      saveStore(opts.storePath, store);
      json(res, 200, { ok: true });
      return;
    }
  }

  json(res, 404, { error: "not found" });
}

function isEnvelope(v: unknown): v is SealedEnvelope {
  return (
    typeof v === "object" &&
    v !== null &&
    "data" in v &&
    "iv" in v &&
    "tag" in v &&
    "salt" in v
  );
}

function loadStore(path: string): StoreShape {
  try {
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, "utf8")) as StoreShape;
    }
  } catch {
    /* fall through to empty */
  }
  return { devices: {} };
}

function saveStore(path: string, store: StoreShape): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(store), "utf8");
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}
