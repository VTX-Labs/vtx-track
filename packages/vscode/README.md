# vtx-track-vscode

The VS Code extension for [vtx-track](https://github.com/VTX-Labs/vtx-track) —
a local-first, privacy-first time tracker for your whole machine.

This extension does **not** track time. It **enriches** the vtx-track daemon's
timeline with IDE context: which workspace folder, git repo and branch, file,
and language you are in, and whether you are editing, viewing, debugging,
running tests, or working in a terminal. A small status-bar widget shows today's
tracked time and links to the local dashboard.

## The no-double-counting design

The vtx-track **daemon** owns the single, machine-wide timeline. It already sees
your VS Code window as the foreground app (matched by the window's process id).

This extension keeps **no clock of its own** and counts no time. While a VS Code
window is focused, it pushes a lightweight context object to the daemon:

```jsonc
{
  "pid": 12345,            // the VS Code window's process id
  "workspace": "vtx-track",
  "repo": "vtx-track",
  "branch": "main",
  "filePath": "packages/vscode/src/extension.ts",
  "language": "typescript",
  "mode": "edit",          // edit | view | debug | test | terminal
  "activelyTyping": true
}
```

The daemon attaches the latest context for that pid to whatever segment it is
already timing. When the window loses focus, the extension stops pushing and the
OS-level app takes over — **one timeline, enriched**. The pushes are debounced
(only deltas are sent) plus a periodic re-push every ~10s while focused so the
daemon's freshness window does not expire.

Either half works alone (graceful degradation):

- **No extension installed** → VS Code is just another tracked app.
- **Daemon not running** → the status bar shows `vtx-track: daemon offline` and
  the extension queues nothing. No shadow clock.

### How `mode` is derived

Highest precedence first:

1. `debug` — a debug session is active.
2. `terminal` — a terminal is focused and there is no active editor.
3. `test` — the active file matches a test/spec convention
   (`*.test.*`, `*.spec.*`, or under a `test`/`tests`/`__tests__` folder).
4. `edit` — you typed within the last ~2s.
5. `view` — an editor is focused but idle (the default).

`activelyTyping` is derived from edits to the focused document within a 2s
window, so reports can split active editing from "editor focused but idle".

## Settings

| Setting | Type | Default | Description |
| :------ | :--- | :------ | :---------- |
| `vtx-track.daemonUrl` | string | `http://127.0.0.1:7842` | Base URL of the local vtx-track daemon's HTTP API. |
| `vtx-track.enabled` | boolean | `true` | Push VS Code context (workspace, repo, branch, file, mode) to the daemon. |
| `vtx-track.sendFilePaths` | boolean | `true` | Include the active file path (relative to the workspace) in the pushed context. Disable to keep file names private; language and mode are still sent. |

## Commands

| Command | Title |
| :------ | :---- |
| `vtx-track.openDashboard` | vtx-track: Open Dashboard |

Clicking the status-bar item also opens the dashboard at the daemon URL.

## Build & install the `.vsix`

The extension is not published to any marketplace — you build a `.vsix` locally
from source and install it into VS Code:

```sh
# from the monorepo root
pnpm --filter vtx-track-vscode build        # emits dist/extension.js (CommonJS)
pnpm --filter vtx-track-vscode package      # produces a .vsix via @vscode/vsce
```

Then in VS Code: open the Command Palette, run
**Extensions: Install from VSIX…**, and pick the generated `.vsix`. Or from a
terminal:

```sh
code --install-extension vtx-track-vscode-0.1.0.vsix
```

The extension activates on startup (`onStartupFinished`) and begins enriching
the daemon's timeline immediately. If the daemon is not running, install it from
[`@vtx-track/cli`](https://github.com/VTX-Labs/vtx-track/tree/main/packages/cli)
and start the service.

## Privacy

- Everything stays on `127.0.0.1`. The extension only talks to your local
  daemon; nothing leaves your machine.
- File paths are sent relative to the workspace (never absolute) and can be
  turned off entirely with `vtx-track.sendFilePaths`.
- The daemon applies its own denylist, redaction, and pause/private modes
  before anything is written to disk.

---

Built by [VTX Labs](https://vtxlabs.dev) · [GitHub](https://github.com/VTX-Labs/vtx-track) · [@vtxlabs](https://x.com/vtxlabs)
