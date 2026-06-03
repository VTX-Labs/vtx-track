# Privacy

vtx-track is built so that **your activity data never has to leave your machine**.
This document is the precise, no-marketing version of what is and isn't recorded.

## The short version

- All data lives in **one local SQLite file**: `~/.vtx-track/vtx-track.db`.
- The daemon's servers bind to **`127.0.0.1` only**. Nothing listens off-machine.
- There is **no telemetry, no analytics, no account, no third-party cloud**.
- The only way data leaves your machine is something **you** trigger: an export,
  or a sync server **you** host (and even then it's end-to-end encrypted).

## What is recorded

For each span of activity the daemon stores a segment: the app/process name, the
executable path, a category, a state (active / idle / locked / private /
idlePrevented / unknown), start and end timestamps, and the machine's hostname.
Optionally, when the corresponding extension is installed and the window is
focused:

- **VS Code:** workspace/project name, git repo and branch, the active file path
  (relative to the workspace), language, and whether you were actively typing.
- **Browser:** the registrable **domain** of the active tab (e.g. `github.com`) —
  never the full URL, path, or query string by default.

## Window titles

Window titles are the most sensitive thing a tracker can see, so they are
handled conservatively. The `redaction` setting has three modes:

| Mode | Behavior |
| :--- | :------- |
| `apps-only` *(default)* | Titles are **dropped entirely**; only app names are kept. |
| `patterns` | Titles are kept but emails, tokens, and long opaque strings are masked. |
| `full` | Titles are kept verbatim. Opt-in only. |

## Controls you have

- **Denylist** — apps or domains you list are never recorded at all; their time
  shows only as a private gap. (`vtx-track config set --deny <name>`)
- **Pause / private mode** — `vtx-track pause` records nothing until you
  `resume`.
- **Export** — `vtx-track export --format json|csv` writes your data wherever you
  want it.
- **Wipe** — `vtx-track wipe --yes` deletes every segment, app, and event.

## Sync (opt-in)

If you run your own [`@vtx-track/sync`](packages/sync) server, your timeline is
encrypted on your machine with AES-256-GCM using a key derived from a passphrase
that **never leaves your device**. The server only ever stores ciphertext and
cannot read your data, even if it's compromised.

## At rest

The local database is not encrypted at rest — it's protected by your OS user
account like any application's data. If your machine handles sensitive work, use
full-disk encryption.

---

Built by [VTX Labs](https://vtxlabs.dev) · [GitHub](https://github.com/VTX-Labs/vtx-track) · [@vtxlabs](https://x.com/vtxlabs)
