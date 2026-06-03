import { describe, expect, it } from "vitest";
import {
  deriveMode,
  isTestFile,
  relativeFilePath,
  type WindowState,
} from "../src/derive.js";

/** A neutral baseline state (an editor focused but idle → "view"). */
function baseState(overrides: Partial<WindowState> = {}): WindowState {
  return {
    debugging: false,
    terminalActive: false,
    hasActiveEditor: true,
    isTestFile: false,
    activelyTyping: false,
    ...overrides,
  };
}

describe("deriveMode", () => {
  it("defaults to view when an editor is focused but idle", () => {
    expect(deriveMode(baseState())).toBe("view");
  });

  it("returns edit when actively typing", () => {
    expect(deriveMode(baseState({ activelyTyping: true }))).toBe("edit");
  });

  it("returns test when the active file is a test file", () => {
    expect(deriveMode(baseState({ isTestFile: true }))).toBe("test");
  });

  it("returns terminal when a terminal is focused and there is no editor", () => {
    expect(
      deriveMode(baseState({ terminalActive: true, hasActiveEditor: false })),
    ).toBe("terminal");
  });

  it("does NOT return terminal when an editor is still active", () => {
    expect(
      deriveMode(baseState({ terminalActive: true, hasActiveEditor: true })),
    ).toBe("view");
  });

  it("returns debug above everything else", () => {
    const state = baseState({
      debugging: true,
      terminalActive: true,
      hasActiveEditor: false,
      isTestFile: true,
      activelyTyping: true,
    });
    expect(deriveMode(state)).toBe("debug");
  });

  it("prefers test over edit", () => {
    expect(deriveMode(baseState({ isTestFile: true, activelyTyping: true }))).toBe(
      "test",
    );
  });

  it("prefers debug over terminal", () => {
    expect(
      deriveMode(
        baseState({ debugging: true, terminalActive: true, hasActiveEditor: false }),
      ),
    ).toBe("debug");
  });
});

describe("isTestFile", () => {
  it("matches *.test.* files", () => {
    expect(isTestFile("src/foo.test.ts")).toBe(true);
    expect(isTestFile("a/b/widget.test.tsx")).toBe(true);
  });

  it("matches *.spec.* files", () => {
    expect(isTestFile("src/foo.spec.js")).toBe(true);
  });

  it("matches files under a test/tests/__tests__ folder", () => {
    expect(isTestFile("packages/x/test/helpers.ts")).toBe(true);
    expect(isTestFile("project/tests/run.py")).toBe(true);
    expect(isTestFile("src/__tests__/component.ts")).toBe(true);
  });

  it("handles Windows backslash separators", () => {
    expect(isTestFile("C:\\repo\\test\\thing.ts")).toBe(true);
    expect(isTestFile("C:\\repo\\src\\thing.test.ts")).toBe(true);
  });

  it("is case-insensitive on the conventional names", () => {
    expect(isTestFile("Src/Foo.Test.TS")).toBe(true);
  });

  it("does not match regular source files", () => {
    expect(isTestFile("src/index.ts")).toBe(false);
    expect(isTestFile("src/contest.ts")).toBe(false);
    expect(isTestFile("src/latest/foo.ts")).toBe(false);
  });
});

describe("relativeFilePath", () => {
  it("makes a posix path relative to its workspace root", () => {
    expect(relativeFilePath("/home/me/proj", "/home/me/proj/src/a.ts")).toBe(
      "src/a.ts",
    );
  });

  it("makes a windows path relative and normalizes slashes", () => {
    expect(
      relativeFilePath("C:\\Users\\me\\proj", "C:\\Users\\me\\proj\\src\\a.ts"),
    ).toBe("src/a.ts");
  });

  it("tolerates a trailing slash on the root", () => {
    expect(relativeFilePath("/home/me/proj/", "/home/me/proj/src/a.ts")).toBe(
      "src/a.ts",
    );
  });

  it("is case-insensitive for the drive prefix on windows", () => {
    expect(
      relativeFilePath("c:\\Users\\me\\proj", "C:\\Users\\me\\proj\\src\\a.ts"),
    ).toBe("src/a.ts");
  });

  it("falls back to the basename when the file is outside the workspace", () => {
    expect(relativeFilePath("/home/me/proj", "/etc/hosts")).toBe("hosts");
  });

  it("falls back to the basename when no workspace root is known", () => {
    expect(relativeFilePath(undefined, "/home/me/proj/src/a.ts")).toBe("a.ts");
    expect(relativeFilePath(undefined, "C:\\x\\y\\file.ts")).toBe("file.ts");
  });
});
