import { describe, expect, it, vi } from "vitest";
import {
  DaemonClient,
  DaemonError,
  DaemonOfflineError,
  type HealthStatus,
} from "../src/index.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A `vi.fn` typed with the global `fetch` signature so `.mock.calls` is `[url, init?]`. */
function mockFetch(impl: typeof fetch): typeof fetch & { mock: { calls: Parameters<typeof fetch>[] } } {
  return vi.fn(impl) as unknown as typeof fetch & {
    mock: { calls: Parameters<typeof fetch>[] };
  };
}

const HEALTH: HealthStatus = {
  ok: true,
  version: "0.1.0",
  uptimeMs: 1000,
  tracking: true,
  paused: false,
  platform: "win32",
  windowIdentificationLimited: false,
};

describe("DaemonClient", () => {
  it("builds the URL and parses health", async () => {
    const fetchImpl = mockFetch(async () => jsonResponse(HEALTH));
    const client = new DaemonClient({ fetch: fetchImpl });
    const health = await client.health();
    expect(health.version).toBe("0.1.0");
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:7842/health",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("encodes query params for summary", async () => {
    const fetchImpl = mockFetch(async () =>
      jsonResponse({ from: 1, to: 2, groupBy: "app", totalMs: 0, rows: [] }),
    );
    const client = new DaemonClient({ fetch: fetchImpl });
    await client.summary({ from: 1, to: 2 }, "app");
    const call = fetchImpl.mock.calls[0];
    expect(call).toBeDefined();
    const url = String(call?.[0]);
    expect(url).toContain("/report/summary");
    expect(url).toContain("from=1");
    expect(url).toContain("to=2");
    expect(url).toContain("by=app");
  });

  it("attaches the bearer token on control calls", async () => {
    const fetchImpl = mockFetch(async () => jsonResponse(HEALTH));
    const client = new DaemonClient({ fetch: fetchImpl, token: "secret" });
    await client.pause();
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init).toBeDefined();
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer secret");
    expect(init?.method).toBe("POST");
  });

  it("throws DaemonError on non-2xx", async () => {
    const fetchImpl = mockFetch(async () => jsonResponse({ error: "nope" }, 403));
    const client = new DaemonClient({ fetch: fetchImpl });
    await expect(client.getConfig()).rejects.toBeInstanceOf(DaemonError);
  });

  it("throws DaemonOfflineError when fetch rejects", async () => {
    const fetchImpl = mockFetch(async () => {
      throw new Error("ECONNREFUSED");
    });
    const client = new DaemonClient({ fetch: fetchImpl });
    await expect(client.health()).rejects.toBeInstanceOf(DaemonOfflineError);
  });

  it("isOnline never throws", async () => {
    const fetchImpl = mockFetch(async () => {
      throw new Error("down");
    });
    const client = new DaemonClient({ fetch: fetchImpl });
    expect(await client.isOnline()).toBe(false);
  });
});
