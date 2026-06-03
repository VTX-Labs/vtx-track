import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { createStaticHandler } from "../src/server.js";

/** Minimal fake req/res just sufficient for the handler's branching. */
function fakeReq(method: string, url: string): IncomingMessage {
  return { method, url } as unknown as IncomingMessage;
}

interface FakeRes {
  statusCode: number;
  headers: Record<string, string | number>;
  headersSent: boolean;
  ended: boolean;
  setHeader(name: string, value: string | number): void;
  end(): void;
  pipe?: never;
}

function fakeRes(): FakeRes & ServerResponse {
  const res: FakeRes = {
    statusCode: 0,
    headers: {},
    headersSent: false,
    ended: false,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end() {
      this.ended = true;
    },
  };
  return res as unknown as FakeRes & ServerResponse;
}

describe("createStaticHandler", () => {
  const handler = createStaticHandler();

  it("returns false for non-GET/HEAD methods", () => {
    const res = fakeRes();
    expect(handler(fakeReq("POST", "/"), res)).toBe(false);
    expect(handler(fakeReq("PUT", "/app.js"), res)).toBe(false);
  });

  it("returns false for a path that escapes the public root", () => {
    const res = fakeRes();
    expect(handler(fakeReq("GET", "/../../secret"), res)).toBe(false);
  });

  it("returns false for a file that does not exist (build not run)", () => {
    // In a fresh tree dist/public may not exist; the handler must not throw and
    // must return false so the daemon falls through to its own 404.
    const res = fakeRes();
    expect(handler(fakeReq("GET", "/definitely-missing.xyz"), res)).toBe(false);
  });

  it("never throws on odd input", () => {
    const res = fakeRes();
    expect(() => handler(fakeReq("GET", "/%zz"), res)).not.toThrow();
    expect(() => handler(fakeReq("GET", "/a%00b"), res)).not.toThrow();
  });
});
