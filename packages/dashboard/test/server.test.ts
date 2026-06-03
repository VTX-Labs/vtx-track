import { describe, expect, it } from "vitest";
import { contentTypeFor, resolveStaticPath } from "../src/server.js";

const ROOT =
  process.platform === "win32" ? "C:\\app\\dist\\public" : "/app/dist/public";

describe("contentTypeFor", () => {
  it("maps known extensions", () => {
    expect(contentTypeFor("/index.html")).toBe("text/html; charset=utf-8");
    expect(contentTypeFor("/app.js")).toBe("text/javascript; charset=utf-8");
    expect(contentTypeFor("/styles.css")).toBe("text/css; charset=utf-8");
    expect(contentTypeFor("/uplot.css")).toBe("text/css; charset=utf-8");
    expect(contentTypeFor("/data.json")).toBe("application/json; charset=utf-8");
    expect(contentTypeFor("/logo.svg")).toBe("image/svg+xml");
    expect(contentTypeFor("/font.woff2")).toBe("font/woff2");
  });

  it("is case-insensitive on the extension", () => {
    expect(contentTypeFor("/INDEX.HTML")).toBe("text/html; charset=utf-8");
  });

  it("falls back to octet-stream for unknown or missing extensions", () => {
    expect(contentTypeFor("/binary.bin")).toBe("application/octet-stream");
    expect(contentTypeFor("/noext")).toBe("application/octet-stream");
  });
});

describe("resolveStaticPath", () => {
  it("routes / and /dashboard to index.html", () => {
    const a = resolveStaticPath("/", ROOT);
    const b = resolveStaticPath("/dashboard", ROOT);
    const c = resolveStaticPath("/dashboard/", ROOT);
    expect(a).toBeTruthy();
    expect(a?.endsWith("index.html")).toBe(true);
    expect(b?.endsWith("index.html")).toBe(true);
    expect(c?.endsWith("index.html")).toBe(true);
  });

  it("resolves normal asset paths under the root", () => {
    const p = resolveStaticPath("/app.js", ROOT);
    expect(p).toBeTruthy();
    expect(p?.startsWith(ROOT)).toBe(true);
    expect(p?.endsWith("app.js")).toBe(true);
  });

  it("strips query strings and hashes", () => {
    const p = resolveStaticPath("/styles.css?v=2#x", ROOT);
    expect(p?.endsWith("styles.css")).toBe(true);
  });

  it("rejects ../ traversal", () => {
    expect(resolveStaticPath("/../secret.txt", ROOT)).toBeNull();
    expect(resolveStaticPath("/../../etc/passwd", ROOT)).toBeNull();
    expect(resolveStaticPath("/a/../../escape", ROOT)).toBeNull();
  });

  it("rejects URL-encoded traversal", () => {
    expect(resolveStaticPath("/%2e%2e/secret", ROOT)).toBeNull();
    expect(resolveStaticPath("/%2e%2e%2f%2e%2e%2fpasswd", ROOT)).toBeNull();
  });

  it("rejects backslash traversal on any platform", () => {
    expect(resolveStaticPath("/..\\secret", ROOT)).toBeNull();
  });

  it("rejects NUL bytes", () => {
    expect(resolveStaticPath("/app.js%00.png", ROOT)).toBeNull();
  });

  it("rejects malformed percent-encoding", () => {
    expect(resolveStaticPath("/%zz", ROOT)).toBeNull();
  });

  it("keeps nested in-root paths", () => {
    const p = resolveStaticPath("/assets/logo.svg", ROOT);
    expect(p).toBeTruthy();
    expect(p?.startsWith(ROOT)).toBe(true);
  });
});
