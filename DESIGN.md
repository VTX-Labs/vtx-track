# vtx-track — Design

> Internal design doc. The product-facing docs live in `README.md` and each
> package's own README. This file is the architectural source of truth.

**vtx-track** is a local-first, privacy-first time tracker for your whole
machine — with first-class depth for VS Code (per-folder, per-file, per-language,
per-branch). It is a headless background **daemon** (a real OS service, *not* an
Electron app) plus thin clients: a VS Code extension, a CLI, a localhost
dashboard, and a browser extension. Everything lives on your machine; nothing
leaves it unless you explicitly turn on export or self-hosted sync.

> A native tray icon is a planned companion (see §10) — it is not part of the
> current build; the daemon is controlled via the CLI, the dashboard, and the
> VS Code status bar.

---

## 1. Principles

1. **Local-first, zero cloud by default.** No network calls in the hot path. The
   only egress is explicit, user-initiated export/sync. This is the product wedge.
2. **Headless daemon, not Electron.** A long-lived background process owns the
   timeline. Tens of MB resident, not hundreds. It runs as a Windows Service,
   a macOS `launchd` LaunchAgent, or a Linux `systemd` user unit.
3. **One language, many surfaces.** Node/TypeScript everywhere; per-OS syscalls
   are isolated behind a single `platform` interface backed by native addons.
4. **No double-counting.** The daemon owns the global timeline. The VS Code
   extension *enriches* daemon events with IDE context; it never keeps its own
   parallel clock. Either half works alone (graceful degradation).
5. **Privacy is a feature, not an afterthought.** Denylist, title redaction,
   pause / private mode, one-click export and wipe — all built into core.
6. **Honest data.** When a platform genuinely can't observe something (Wayland
   active window), the daemon records `unknown` rather than fabricating activity.

---

## 2. Topology

```
                    ┌──────────────────────────────────────────────┐
                    │   vtx-track DAEMON  (@vtx-track/daemon)        │
                    │   headless, runs as an OS service              │
                    │                                                │
                    │   sampler ── platform (window + idle) native   │
                    │     │                                          │
                    │     ▼                                          │
                    │   sessionizer → categorize → privacy filter    │
                    │     │                                          │
                    │     ▼                                          │
                    │   store (better-sqlite3, WAL)                  │
                    │     ▲                                          │
                    │   localhost HTTP API (127.0.0.1) + IPC socket  │
                    └───▲──────────▲───────────▲──────────▲──────────┘
        IPC / 127.0.0.1│          │           │          │
        ┌───────────────┘   ┌──────┘     ┌─────┘     ┌────┘
   ┌────┴──────┐     ┌───────┴────┐  ┌────┴─────┐ ┌──┴──────────────┐
   │ VS Code   │     │ Browser    │  │   CLI    │ │  Dashboard       │
   │ extension │     │ extension  │  │vtx-track │ │  localhost web   │
   │@…/vscode  │     │ (MV3)      │  │@…/cli    │ │  @…/dashboard    │
   └───────────┘     └────────────┘  └──────────┘ └──────────────────┘
```

---

## 3. Packages (pnpm workspace)

| Package | Role | Runs where |
| :------ | :--- | :--------- |
| `@vtx-track/core` | Domain model, sessionizer, categorization engine, privacy filter, SQLite store + migrations, reporting/query layer. Zero native deps; pure logic. | everywhere |
| `@vtx-track/platform` | Per-OS active-window + idle behind one interface. Native addons + Wayland detection/fallback. | daemon |
| `@vtx-track/daemon` | The service: sampler loop (event-driven + 5s heartbeat), HTTP API, IPC socket, lifecycle. | background |
| `@vtx-track/protocol` | Shared wire types + a typed HTTP client used by CLI/extension/dashboard. No deps. | everywhere |
| `@vtx-track/service` | Cross-OS service install/uninstall (Windows Task Scheduler, launchd, systemd user unit). | install-time |
| `@vtx-track/cli` | `vtx-track …` — start/stop service, today/week/project reports, export, config, privacy. | terminal |
| `@vtx-track/vscode` | VS Code extension: folder/file/language/branch/debug/test enrichment + status bar. | VS Code |
| `@vtx-track/dashboard` | Minimal no-framework localhost UI (vanilla TS + uPlot), served by the daemon. | browser |
| `@vtx-track/sync` | Optional self-hosted sync server + client (encrypted, multi-machine merge). | opt-in |
| `@vtx-track/integrations` | Export/import: WakaTime, Toggl, Clockify, generic CSV/JSON, Git/GitHub/Jira linking. | opt-in |
| `apps/browser-extension` | Tab/domain granularity for browsers (MV3), reports to daemon over localhost. | browsers |

**npm scope:** `@vtx-track/*` (user decision; overrides the org default
`@vtx-labs`). CLI bin: `vtx-track` (alias `vtt`).

---

## 4. The sampling model (event-driven + 5s heartbeat)

The daemon never busy-polls every second. Two signals drive it:

1. **Focus-change events** — `@paymoapp/active-window`'s `subscribe()` fires the
   instant the foreground window changes. This closes the current segment and
   opens a new one with precise boundaries.
2. **A 5s heartbeat** — a timer that (a) updates the duration of the open segment,
   (b) reads idle state, and (c) catches title changes within the same app
   (e.g. switching files in an app that doesn't fire a focus event).

**Idle handling** uses `@paymoapp/real-idle.getIdleState(threshold)`:
- `active` → accrue time to the current app.
- `idlePrevented` → user is watching a video / in a meeting → still counts (this
  is the "smart idle" win); tagged so reports can separate it.
- `idle` → no input past threshold → the open segment is closed at
  `lastActivity` and an `idle` segment opens. Time after going idle is *not*
  attributed to the app.
- `locked` → close segment, open a `locked` gap.
- `unknown` → platform couldn't read it (e.g. Wayland) → recorded honestly.

Default idle threshold: **120s**. Heartbeat: **5s**. Both configurable.

### Sessionizer

Raw `(timestamp, app, title, idleState, …)` samples are folded into **segments**:
contiguous spans of the same `(app, normalizedTitle, category, vscodeContext)`.
A segment closes when any key field changes, idle/lock begins, or the daemon
stops. Segments are the unit written to SQLite. A nightly compaction merges
sub-threshold micro-segments (< 2s flickers) into their neighbours.

---

## 5. The bridge (daemon ↔ VS Code) — no double counting

The daemon is the single clock. The extension's job is **enrichment**, not
timing.

- On activation, the extension connects to the daemon over the IPC socket and
  registers as the "context provider for VS Code windows" (keyed by the VS Code
  process PID, which the daemon already sees as the foreground app).
- While a VS Code window is focused, the extension pushes a lightweight
  `VsCodeContext` whenever it changes: `{ pid, workspaceFolder, repo, branch,
  filePath, languageId, mode: 'edit'|'view'|'debug'|'test'|'terminal',
  activelyTyping }`. Debounced; only deltas.
- The daemon attaches the latest context for that PID to whatever segment it is
  already timing. When VS Code loses focus, the daemon simply stops attaching
  context — the OS-level app takes over. **One timeline, enriched.**
- If the extension isn't installed, VS Code is just another tracked app. If the
  daemon isn't running, the extension shows "daemon offline" in the status bar
  and queues nothing (no shadow clock).

`activelyTyping` is derived from `onDidChangeTextDocument` within a 2s window, so
reports can split **active editing** from **editor focused but idle**.

---

## 6. Data model (SQLite, better-sqlite3, WAL mode)

One file: `~/.vtx-track/vtx-track.db` (overridable). WAL for concurrent reads
from CLI/dashboard while the daemon writes. `user_version` pragma drives
migrations.

```sql
-- Apps seen on this machine (dedup by exe path + name).
CREATE TABLE app (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,          -- "Code", "chrome", "Slack"
  exe_path      TEXT NOT NULL,
  display_name  TEXT,                   -- user-friendly override
  category_id   INTEGER REFERENCES category(id),
  UNIQUE(name, exe_path)
);

CREATE TABLE category (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE,           -- Coding, Comms, Browsing, Design, …
  color TEXT                            -- hex for the dashboard
);

-- The core timeline. Each row is one resolved segment.
CREATE TABLE segment (
  id           INTEGER PRIMARY KEY,
  app_id       INTEGER NOT NULL REFERENCES app(id),
  title        TEXT,                    -- post-redaction window title
  started_at   INTEGER NOT NULL,        -- epoch ms
  ended_at     INTEGER NOT NULL,        -- epoch ms
  duration_ms  INTEGER NOT NULL,        -- ended_at - started_at (denorm for fast sums)
  state        TEXT NOT NULL,           -- active | idlePrevented | idle | locked | unknown
  host         TEXT NOT NULL            -- machine id, for multi-machine sync
);
CREATE INDEX idx_segment_started ON segment(started_at);
CREATE INDEX idx_segment_app     ON segment(app_id, started_at);

-- VS Code (and future IDE) enrichment, 1:0..1 with a segment.
CREATE TABLE vscode_context (
  segment_id  INTEGER PRIMARY KEY REFERENCES segment(id) ON DELETE CASCADE,
  workspace   TEXT,                     -- workspace folder name
  repo        TEXT,                     -- git repo name / remote
  branch      TEXT,
  file_path   TEXT,                     -- relative to workspace (redactable)
  language    TEXT,                     -- languageId
  mode        TEXT,                     -- edit | view | debug | test | terminal
  active_edit INTEGER NOT NULL DEFAULT 0 -- 0/1 was the user actually typing
);

-- Browser enrichment (from the browser extension), 1:0..1 with a segment.
CREATE TABLE browser_context (
  segment_id INTEGER PRIMARY KEY REFERENCES segment(id) ON DELETE CASCADE,
  domain     TEXT,                      -- never the full URL/query by default
  tab_title  TEXT
);

-- Append-only event log used to derive goals/streaks and to debug.
CREATE TABLE event (
  id         INTEGER PRIMARY KEY,
  at         INTEGER NOT NULL,
  kind       TEXT NOT NULL,             -- focus | idle | resume | lock | pause | daemon_start …
  detail     TEXT                       -- json
);

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);  -- machine id, install ts, …
```

Reporting is plain SQL aggregation over `segment` (+ joins). No ORM.

---

## 7. Categorization

A rule engine in `core`. Each rule matches on `app.name`, `exe_path` glob, or
window-title regex → assigns a `category`. Ships with sensible defaults
(VS Code/JetBrains/terminals → Coding; Slack/Discord/Teams → Comms; browsers →
Browsing; Figma → Design; Zoom/Meet → Meetings; Spotify/Netflix → Entertainment).
User rules live in config and win over defaults. Unmatched → "Uncategorized".
Browser segments can be re-categorized by domain when the browser extension is
present (github.com → Coding, youtube.com → Entertainment).

---

## 8. Privacy model (first-class)

Applied in the daemon **before** anything is written to disk:

- **Denylist** — apps or domains that are never logged at all (password managers,
  banking). Matched segment → dropped entirely (recorded only as a `private` gap).
- **Title redaction** — modes: `full` (keep titles), `apps-only` (drop all
  titles, keep app names), `patterns` (regex redaction of e.g. emails, tokens).
  Default: `apps-only` is offered at first run; `full` requires opt-in.
- **Pause / Private mode** — a hotkey / tray toggle / `vtx-track pause` that stops
  all logging until resumed. Private mode logs a gap, never content.
- **Local only** — the HTTP/IPC servers bind to `127.0.0.1` exclusively; the
  socket is `0600`. No telemetry, ever.
- **Ownership** — `vtx-track export` (JSON/CSV) and `vtx-track wipe` (delete all
  data, with confirmation) are first-class commands.

---

## 9. Transport

- **HTTP API** on `127.0.0.1:7842` (configurable) — used by the dashboard
  (browser can't open a unix socket) and as a fallback for clients. Read
  endpoints for reports; control endpoints (pause/resume/config) require a local
  token stored in `~/.vtx-track/token` (`0600`) to stop other localhost apps
  from poking it.
- **IPC socket** — Windows named pipe `\\.\pipe\vtx-track`, unix domain socket
  `~/.vtx-track/daemon.sock` elsewhere — used by the VS Code extension and CLI
  (lower latency, no token dance for same-user processes; enforced by socket
  perms / pipe ACL).
- `@vtx-track/protocol` defines every request/response type and ships a typed
  client so no surface hand-rolls fetch calls.

### Key endpoints

```
GET  /health                      → { ok, version, uptime, tracking }
GET  /report/summary?from&to&by   → totals grouped by app|category|project|language
GET  /report/timeline?from&to     → segments for the timeline view
GET  /report/focus?date           → context-switch count, longest deep-work span
GET  /report/standup?date         → human-readable daily summary
GET  /report/timesheet?from&to&by → billable rollup per project/client
POST /context/vscode              → extension enrichment push (IPC only)
POST /context/browser             → browser-extension enrichment push
POST /control/pause | /resume     → toggle tracking (token/ipc)
GET/PUT /config                   → read/update config (token/ipc)
POST /control/wipe                → delete all data (token/ipc, confirmed)
```

---

## 10. Service lifecycle (`@vtx-track/service`)

`vtx-track service install|uninstall|start|stop|status` resolves to the right
mechanism:

- **Windows** — register via the Service Control Manager (a thin service wrapper
  around the daemon entry) or, as a no-admin fallback, a logon Scheduled Task.
- **macOS** — write a `~/Library/LaunchAgents/dev.vtxlabs.track.plist` LaunchAgent
  (`RunAtLoad`, `KeepAlive`) and `launchctl bootstrap`.
- **Linux** — write `~/.config/systemd/user/vtx-track.service` and
  `systemctl --user enable --now`.

A **tray** companion (planned, not yet built) would show tracking on/off,
today's total, "pause 30 min", "open dashboard", and "quit". Until then the
daemon is controlled via the CLI (`vtx-track pause`/`resume`/`status`), the
dashboard, and the VS Code status bar.

---

## 11. Cross-platform reality (the honest matrix)

| Capability | Windows | macOS | Linux X11 | Linux Wayland |
| :--------- | :-----: | :---: | :-------: | :-----------: |
| Active app/exe/pid | ✅ | ✅ | ✅ | ⚠️ via portal/compositor adapter |
| Window title | ✅ | ✅ (needs Screen Recording perm) | ✅ | ❌ (security model forbids) |
| Idle seconds | ✅ | ✅ | ✅ | ✅ |
| Smart idle (video/meeting) | ➖ | ✅ | ✅ (X11 + GNOME) | ⚠️ |
| Lock detection | ➖ | ✅ | ➖ | ➖ |

On Wayland the daemon records `state = unknown` for window identity rather than
guessing, and the dashboard surfaces a one-time "limited on Wayland" note with a
link to enable the GNOME/KWin adapter. Idle still works everywhere.

---

## 12. Roadmap (build order)

- **v1 — local-first core:** core + platform + daemon + protocol + bridge + cli +
  vscode extension + service + minimal dashboard. A complete, usable product.
- **v2 — insights:** focus/context-switch metrics, deep-work streaks, heatmaps,
  goals & limits with nudges, standup + billable-timesheet generators.
- **v3 — reach:** browser extension (tab/domain), self-hosted encrypted sync,
  Wayland compositor adapters, integrations (WakaTime/Toggl/Clockify export,
  Git/GitHub/Jira linking).

All three are implemented in this repo; v2/v3 ride on the v1 store + protocol.

---

## 13. Stack summary

Node/TS · pnpm workspaces · tsup (ESM + d.ts) · vitest · strict TS.
Native: `@paymoapp/active-window` (2.1.4), `@paymoapp/real-idle` (1.1.2),
`better-sqlite3` (12.x). Charts: `uPlot`. No Electron, no framework in the
dashboard, minimal justified deps everywhere — bloat-free is the brand.
