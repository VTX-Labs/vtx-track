import { describe, expect, it } from "vitest";
import { isDenied, registrableDomain } from "../src/domain.js";

describe("registrableDomain", () => {
  it("strips protocol, www, path, and query", () => {
    expect(registrableDomain("https://www.github.com/VTX-Labs/x?q=1")).toBe("github.com");
  });

  it("keeps a bare hostname and drops the port", () => {
    expect(registrableDomain("http://localhost:3000")).toBe("localhost");
  });

  it("returns empty for browser-internal pages", () => {
    expect(registrableDomain("chrome://extensions")).toBe("");
  });

  it("skips extension and about pages", () => {
    expect(registrableDomain("chrome-extension://abc/popup.html")).toBe("");
    expect(registrableDomain("about:blank")).toBe("");
    expect(registrableDomain("edge://settings")).toBe("");
    expect(registrableDomain("moz-extension://abc/x.html")).toBe("");
  });

  it("skips file, data, and view-source URLs", () => {
    expect(registrableDomain("file:///C:/Users/x/index.html")).toBe("");
    expect(registrableDomain("data:text/html,<b>hi</b>")).toBe("");
    expect(registrableDomain("view-source:https://github.com")).toBe("");
  });

  it("lowercases the hostname", () => {
    expect(registrableDomain("https://GitHub.COM/path")).toBe("github.com");
  });

  it("keeps non-www subdomains intact", () => {
    expect(registrableDomain("https://app.example.com/dashboard")).toBe("app.example.com");
    expect(registrableDomain("https://docs.github.com")).toBe("docs.github.com");
  });

  it("returns empty for blank, null, or unparseable input", () => {
    expect(registrableDomain("")).toBe("");
    expect(registrableDomain(undefined)).toBe("");
    expect(registrableDomain(null)).toBe("");
    expect(registrableDomain("not a url")).toBe("");
  });
});

describe("isDenied", () => {
  it("treats an empty domain as denied (nothing to track)", () => {
    expect(isDenied("", ["github.com"])).toBe(true);
  });

  it("matches an exact domain", () => {
    expect(isDenied("github.com", ["github.com"])).toBe(true);
    expect(isDenied("github.com", ["example.com"])).toBe(false);
  });

  it("matches subdomains of a denied domain", () => {
    expect(isDenied("app.example.com", ["example.com"])).toBe(true);
    expect(isDenied("notexample.com", ["example.com"])).toBe(false);
  });

  it("is case-insensitive and trims entries", () => {
    expect(isDenied("github.com", [" GitHub.com "])).toBe(true);
  });

  it("ignores empty denylist entries", () => {
    expect(isDenied("github.com", ["", "   "])).toBe(false);
  });
});
