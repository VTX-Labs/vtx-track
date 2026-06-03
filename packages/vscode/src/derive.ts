/**
 * Pure, framework-free helpers for deriving VS Code context fields.
 *
 * This module intentionally imports NOTHING from the `vscode` runtime module:
 * the real `vscode` module only exists inside the extension host, so keeping the
 * logic here as plain functions over plain data makes it unit-testable with
 * vitest. The thin glue in `extension.ts` reads the live VS Code API and feeds
 * the resulting primitives into these functions.
 */

import type { VsCodeMode } from "@vtx-track/protocol";

/**
 * The observable state of a VS Code window, reduced to the primitives needed to
 * pick a {@link VsCodeMode}. All booleans are derived from VS Code events in
 * `extension.ts`; this function holds the precedence rules.
 */
export interface WindowState {
  /** A debug session is currently running. */
  debugging: boolean;
  /** A terminal is the active panel (the user is focused on a terminal). */
  terminalActive: boolean;
  /** There is an active text editor. */
  hasActiveEditor: boolean;
  /** The active editor's file path matches a test/spec convention. */
  isTestFile: boolean;
  /** The user typed within the recent active-edit window (~2s). */
  activelyTyping: boolean;
}

/**
 * Pick the {@link VsCodeMode} for a window from its observable state.
 *
 * Precedence (highest first):
 * 1. `debug`    — a debug session is active.
 * 2. `terminal` — a terminal is focused and there is no active editor.
 * 3. `test`     — the active file is a test/spec file.
 * 4. `edit`     — the user typed recently.
 * 5. `view`     — an editor is focused but idle (the default).
 */
export function deriveMode(state: WindowState): VsCodeMode {
  if (state.debugging) return "debug";
  if (state.terminalActive && !state.hasActiveEditor) return "terminal";
  if (state.isTestFile) return "test";
  if (state.activelyTyping) return "edit";
  return "view";
}

/**
 * Make `file` relative to `workspaceRoot`, using forward slashes regardless of
 * platform so stored paths are stable across OSes.
 *
 * Returns the basename when `file` is not inside `workspaceRoot` (or when no
 * workspace root is known), so we never leak an absolute path through the
 * `filePath` field.
 */
export function relativeFilePath(
  workspaceRoot: string | undefined,
  file: string,
): string {
  const normFile = normalizeSlashes(file);
  if (!workspaceRoot) return basename(normFile);

  let root = normalizeSlashes(workspaceRoot);
  if (!root.endsWith("/")) root += "/";

  // Case-insensitive prefix match: Windows paths differ only by drive-letter
  // case and separator style, which we have already normalized.
  if (normFile.toLowerCase().startsWith(root.toLowerCase())) {
    return normFile.slice(root.length);
  }
  return basename(normFile);
}

/**
 * True when `path` looks like a test or spec file by common conventions:
 * `*.test.*`, `*.spec.*`, or living under a `test`/`tests`/`__tests__` folder.
 */
export function isTestFile(path: string): boolean {
  const p = normalizeSlashes(path).toLowerCase();
  const name = basename(p);
  if (/\.(test|spec)\.[^.]+$/.test(name)) return true;
  if (/(^|\/)(test|tests|__tests__)\//.test(p)) return true;
  return false;
}

// ── internals ──────────────────────────────────────────────────────────────

/** Convert backslashes to forward slashes (Windows path normalization). */
function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, "/");
}

/** The final path segment of a slash-normalized path. */
function basename(p: string): string {
  const trimmed = p.endsWith("/") ? p.slice(0, -1) : p;
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}
