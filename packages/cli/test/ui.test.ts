import { describe, expect, it } from "vitest";
import { barRow, color, table } from "../src/ui.js";
import { BANNER_LINES } from "../src/banner.js";

describe("ui", () => {
  it("renders a bar row with a label and value", () => {
    const row = barRow("Code", "2h 14m", 0.5, 8);
    expect(row).toContain("Code");
    expect(row).toContain("2h 14m");
  });

  it("renders a two-column table", () => {
    const t = table([
      ["platform", "win32"],
      ["uptime", "1h"],
    ]);
    expect(t).toContain("platform");
    expect(t).toContain("win32");
  });

  it("color helpers return the input text (NO_COLOR safe)", () => {
    // In a non-TTY test runner, color is disabled and returns the raw string.
    expect(color.green("ok")).toContain("ok");
  });

  it("the banner has six aligned wordmark lines", () => {
    expect(BANNER_LINES).toHaveLength(6);
    for (const line of BANNER_LINES) {
      expect(line.length).toBeGreaterThan(40);
    }
  });
});
