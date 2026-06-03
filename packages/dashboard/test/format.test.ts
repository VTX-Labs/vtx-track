import { describe, expect, it } from "vitest";
import {
  formatClock,
  formatDuration,
  formatHours,
  formatPercent,
  startOfDay,
  toDateString,
} from "../src/format.js";

describe("formatDuration", () => {
  it("clamps non-positive and non-finite to 0m", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(-5000)).toBe("0m");
    expect(formatDuration(Number.NaN)).toBe("0m");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("0m");
  });

  it("shows seconds under a minute", () => {
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(1_000)).toBe("1s");
  });

  it("shows minutes under an hour", () => {
    expect(formatDuration(3 * 60_000)).toBe("3m");
    expect(formatDuration(59 * 60_000)).toBe("59m");
  });

  it("shows hours and minutes past an hour", () => {
    expect(formatDuration(65 * 60_000)).toBe("1h 5m");
    expect(formatDuration(120 * 60_000)).toBe("2h 0m");
    expect(formatDuration(150 * 60_000)).toBe("2h 30m");
  });
});

describe("formatPercent", () => {
  it("formats and clamps shares", () => {
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(0.42)).toBe("42%");
    expect(formatPercent(1)).toBe("100%");
    expect(formatPercent(1.5)).toBe("100%");
    expect(formatPercent(-1)).toBe("0%");
    expect(formatPercent(Number.NaN)).toBe("0%");
  });
});

describe("formatHours", () => {
  it("formats to one decimal", () => {
    expect(formatHours(1.5)).toBe("1.5h");
    expect(formatHours(0)).toBe("0.0h");
    expect(formatHours(Number.NaN)).toBe("0.0h");
  });
});

describe("formatClock", () => {
  it("formats a timestamp as HH:MM", () => {
    const d = new Date(2026, 0, 1, 9, 5, 0);
    expect(formatClock(d.getTime())).toBe("09:05");
    const d2 = new Date(2026, 0, 1, 23, 59, 0);
    expect(formatClock(d2.getTime())).toBe("23:59");
  });
});

describe("toDateString / startOfDay", () => {
  it("formats a date as YYYY-MM-DD", () => {
    expect(toDateString(new Date(2026, 5, 3))).toBe("2026-06-03");
    expect(toDateString(new Date(2026, 11, 9))).toBe("2026-12-09");
  });

  it("startOfDay zeroes the time component", () => {
    const d = new Date(2026, 5, 3, 14, 30, 15, 500);
    const start = new Date(startOfDay(d));
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getSeconds()).toBe(0);
    expect(start.getMilliseconds()).toBe(0);
    expect(start.getFullYear()).toBe(2026);
  });
});
