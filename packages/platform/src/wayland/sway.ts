import { connect } from "node:net";
import type { WindowSample } from "@vtx-track/protocol";
import type { WaylandAdapter, WaylandEnv } from "./types.js";

/**
 * Sway / i3 IPC adapter.
 *
 * Sway implements the i3 IPC protocol: messages are framed as
 * `"i3-ipc"` (6 bytes) + payload-length (uint32 LE) + message-type (uint32 LE)
 * + JSON payload. We send `GET_TREE` (type 4) and walk the returned node tree
 * to the node with `focused: true`, which carries the app id and title.
 *
 * Both the framing and the tree-walk are pure and unit-tested from fixtures;
 * only the socket round-trip is Linux-only.
 */

const MAGIC = "i3-ipc";
const TYPE_GET_TREE = 4;

/** A node in sway/i3's window tree (only the fields we read). */
export interface SwayNode {
  focused?: boolean;
  name?: string | null;
  app_id?: string | null;
  pid?: number;
  window_properties?: { class?: string; instance?: string; title?: string };
  nodes?: SwayNode[];
  floating_nodes?: SwayNode[];
}

/** Encode an i3-ipc request frame. */
export function encodeRequest(type: number, payload = ""): Buffer {
  const body = Buffer.from(payload, "utf8");
  const header = Buffer.alloc(MAGIC.length + 8);
  header.write(MAGIC, 0, "ascii");
  header.writeUInt32LE(body.length, MAGIC.length);
  header.writeUInt32LE(type, MAGIC.length + 4);
  return Buffer.concat([header, body]);
}

/**
 * Decode one i3-ipc reply from a buffer. Returns the JSON text and the number
 * of bytes consumed, or null if the buffer doesn't yet hold a full frame.
 */
export function decodeReply(
  buf: Buffer,
): { type: number; json: string; consumed: number } | null {
  const headerLen = MAGIC.length + 8;
  if (buf.length < headerLen) return null;
  if (buf.toString("ascii", 0, MAGIC.length) !== MAGIC) {
    throw new Error("sway IPC: bad magic");
  }
  const len = buf.readUInt32LE(MAGIC.length);
  const type = buf.readUInt32LE(MAGIC.length + 4);
  if (buf.length < headerLen + len) return null;
  const json = buf.toString("utf8", headerLen, headerLen + len);
  return { type, json, consumed: headerLen + len };
}

/** Depth-first search for the focused leaf node in a sway/i3 tree. */
export function findFocused(root: SwayNode): SwayNode | null {
  if (root.focused) return root;
  for (const child of [...(root.nodes ?? []), ...(root.floating_nodes ?? [])]) {
    const hit = findFocused(child);
    if (hit) return hit;
  }
  return null;
}

/** Map a focused sway/i3 node to a {@link WindowSample}. */
export function nodeToSample(node: SwayNode): WindowSample {
  const props = node.window_properties ?? {};
  const app = node.app_id || props.class || props.instance || "unknown";
  const title = node.name || props.title || "";
  return {
    app,
    title,
    exePath: "",
    pid: typeof node.pid === "number" ? node.pid : -1,
  };
}

/** Send a single request to a sway/i3 socket and return the JSON reply text. */
export function querySocket(
  socketPath: string,
  type: number,
  payload = "",
  timeoutMs = 1000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = connect(socketPath);
    const chunks: Buffer[] = [];
    let settled = false;
    const done = (err: Error | null, value?: string): void => {
      if (settled) return;
      settled = true;
      sock.destroy();
      if (err) reject(err);
      else resolve(value ?? "");
    };
    const timer = setTimeout(() => done(new Error("sway IPC: timeout")), timeoutMs);
    if (timer.unref) timer.unref();

    sock.on("connect", () => sock.write(encodeRequest(type, payload)));
    sock.on("data", (d: Buffer) => {
      chunks.push(d);
      try {
        const reply = decodeReply(Buffer.concat(chunks));
        if (reply) {
          clearTimeout(timer);
          done(null, reply.json);
        }
      } catch (e) {
        clearTimeout(timer);
        done(e as Error);
      }
    });
    sock.on("error", (e) => {
      clearTimeout(timer);
      done(e);
    });
  });
}

export const swayAdapter: WaylandAdapter = {
  name: "sway/i3",
  isAvailable(env: WaylandEnv): boolean {
    return Boolean(env.swaySock || env.i3Sock);
  },
  async getActiveWindow(env: WaylandEnv): Promise<WindowSample | null> {
    const socketPath = env.swaySock || env.i3Sock;
    if (!socketPath) return null;
    try {
      const json = await querySocket(socketPath, TYPE_GET_TREE);
      const tree = JSON.parse(json) as SwayNode;
      const focused = findFocused(tree);
      return focused ? nodeToSample(focused) : null;
    } catch {
      return null;
    }
  },
};
