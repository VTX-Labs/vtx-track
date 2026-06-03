import { describe, expect, it } from "vitest";
import { PrivacyFilter } from "../src/privacy.js";
import { defaultConfig } from "../src/config.js";
import type { WindowSample } from "@vtx-track/protocol";

function sample(app: string, title = ""): WindowSample {
  return { app, title, exePath: "", pid: 1 };
}

describe("PrivacyFilter", () => {
  it("apps-only drops titles by default", () => {
    const f = new PrivacyFilter(defaultConfig());
    const d = f.apply(sample("Code", "secret.ts — vtx-track"));
    expect(d.denied).toBe(false);
    expect(d.title).toBeNull();
  });

  it("full mode keeps titles", () => {
    const f = new PrivacyFilter({ ...defaultConfig(), redaction: "full" });
    const d = f.apply(sample("Code", "a.ts"));
    expect(d.title).toBe("a.ts");
  });

  it("denylist denies matching apps", () => {
    const f = new PrivacyFilter({
      ...defaultConfig(),
      denylist: ["1Password"],
    });
    expect(f.apply(sample("1Password", "vault")).denied).toBe(true);
    expect(f.apply(sample("Code", "a.ts")).denied).toBe(false);
  });

  it("denylist denies matching domains", () => {
    const f = new PrivacyFilter({
      ...defaultConfig(),
      denylist: ["bank.com"],
    });
    expect(f.apply(sample("chrome", "Banking"), "bank.com").denied).toBe(true);
  });

  it("patterns mode masks emails and tokens", () => {
    const f = new PrivacyFilter({
      ...defaultConfig(),
      redaction: "patterns",
    });
    const d = f.apply(sample("chrome", "mail to bob@example.com inbox"));
    expect(d.title).toContain("[redacted]");
    expect(d.title).not.toContain("bob@example.com");
  });
});
