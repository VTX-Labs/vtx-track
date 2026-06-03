import { describe, expect, it } from "vitest";
import { Categorizer, UNCATEGORIZED } from "../src/categorize.js";
import type { WindowSample } from "@vtx-track/protocol";

function sample(app: string, exePath = "", title = ""): WindowSample {
  return { app, exePath, title, pid: 1 };
}

describe("Categorizer", () => {
  const cat = new Categorizer();

  it("categorizes known coding apps", () => {
    expect(cat.categorize(sample("Code"))).toBe("Coding");
    expect(cat.categorize(sample("cursor"))).toBe("Coding");
  });

  it("categorizes comms and browsers", () => {
    expect(cat.categorize(sample("Slack"))).toBe("Comms");
    expect(cat.categorize(sample("chrome"))).toBe("Browsing");
  });

  it("falls back to Uncategorized", () => {
    expect(cat.categorize(sample("SomeRandomApp"))).toBe(UNCATEGORIZED);
  });

  it("uses domain rules for browser segments", () => {
    expect(cat.categorize(sample("chrome"), "github.com")).toBe("Coding");
    expect(cat.categorize(sample("chrome"), "youtube.com")).toBe(
      "Entertainment",
    );
  });

  it("lets user rules win over built-ins", () => {
    const custom = new Categorizer([{ app: "chrome", category: "Research" }]);
    expect(custom.categorize(sample("chrome"))).toBe("Research");
  });

  it("matches exe globs", () => {
    const custom = new Categorizer([
      { exeGlob: "**/MyTool.exe", category: "Coding" },
    ]);
    expect(custom.categorize(sample("x", "C:/Program Files/MyTool.exe"))).toBe(
      "Coding",
    );
  });

  it("matches title regex", () => {
    const custom = new Categorizer([
      { titleRegex: "Pull Request", category: "Coding" },
    ]);
    expect(
      custom.categorize(sample("chrome", "", "Open Pull Request #12")),
    ).toBe("Coding");
  });

  it("ignores invalid user regex without throwing", () => {
    const custom = new Categorizer([
      { titleRegex: "(unclosed", category: "Coding" },
    ]);
    expect(custom.categorize(sample("x", "", "anything"))).toBe(UNCATEGORIZED);
  });
});
