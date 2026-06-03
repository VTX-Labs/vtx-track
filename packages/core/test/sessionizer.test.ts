import { describe, expect, it } from "vitest";
import { Sessionizer, type Observation } from "../src/sessionizer.js";
import type { IdleReading, WindowSample } from "@vtx-track/protocol";

function obs(
  at: number,
  app: string,
  title: string,
  state: IdleReading["state"] = "active",
  extra: Partial<Observation> = {},
): Observation {
  const sample: WindowSample = {
    app,
    title,
    exePath: `C:/Apps/${app}.exe`,
    pid: 1000,
  };
  return {
    at,
    sample,
    idle: { state, idleSeconds: 0, locked: state === "locked" },
    category: "Coding",
    title,
    denied: false,
    ...extra,
  };
}

describe("Sessionizer", () => {
  it("emits a segment when the app changes", () => {
    const s = new Sessionizer();
    expect(s.push(obs(0, "Code", "a.ts"))).toBeNull();
    const seg = s.push(obs(10_000, "chrome", "github"));
    expect(seg).not.toBeNull();
    expect(seg?.app).toBe("Code");
    expect(seg?.durationMs).toBe(10_000);
    expect(seg?.state).toBe("active");
  });

  it("keeps one segment while context is unchanged", () => {
    const s = new Sessionizer();
    s.push(obs(0, "Code", "a.ts"));
    expect(s.push(obs(5_000, "Code", "a.ts"))).toBeNull();
    const seg = s.flush(8_000);
    expect(seg?.durationMs).toBe(8_000);
  });

  it("splits when the title changes within the same app", () => {
    const s = new Sessionizer();
    s.push(obs(0, "Code", "a.ts"));
    const seg = s.push(obs(4_000, "Code", "b.ts"));
    expect(seg?.title).toBe("a.ts");
    expect(seg?.durationMs).toBe(4_000);
  });

  it("collapses idle into a single gap segment regardless of prior app", () => {
    const s = new Sessionizer();
    s.push(obs(0, "Code", "a.ts"));
    s.push(obs(2_000, "Code", "a.ts", "idle")); // closes Code, opens idle gap
    const seg = s.flush(60_000);
    expect(seg?.state).toBe("idle");
    expect(seg?.app).toBe("Code"); // the app that was idle, recorded honestly
  });

  it("records denied spans as private with no title", () => {
    const s = new Sessionizer();
    s.push(obs(0, "1Password", "vault", "active", { denied: true }));
    const seg = s.flush(10_000);
    expect(seg?.state).toBe("private");
    expect(seg?.app).toBe("private");
    expect(seg?.title).toBeNull();
    expect(seg?.category).toBe("Private");
  });

  it("discards sub-second flicker", () => {
    const s = new Sessionizer();
    s.push(obs(0, "Code", "a.ts"));
    const seg = s.push(obs(500, "chrome", "x")); // only 500ms on Code
    expect(seg).toBeNull();
  });

  it("only attaches vscode context to active/idlePrevented segments", () => {
    const s = new Sessionizer();
    const vscode = {
      pid: 1000,
      mode: "edit" as const,
      activelyTyping: true,
      workspace: "vtx-track",
    };
    s.push(obs(0, "Code", "a.ts", "active", { vscode }));
    const seg = s.push(obs(5_000, "chrome", "x"));
    expect(seg?.vscode?.workspace).toBe("vtx-track");
  });
});
