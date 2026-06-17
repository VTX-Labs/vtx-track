```
██╗   ██╗████████╗██╗  ██╗    ████████╗██████╗  █████╗  ██████╗██╗  ██╗
██║   ██║╚══██╔══╝╚██╗██╔╝    ╚══██╔══╝██╔══██╗██╔══██╗██╔════╝██║ ██╔╝
██║   ██║   ██║    ╚███╔╝        ██║   ██████╔╝███████║██║     █████╔╝
╚██╗ ██╔╝   ██║    ██╔██╗        ██║   ██╔══██╗██╔══██║██║     ██╔═██╗
 ╚████╔╝    ██║   ██╔╝ ██╗       ██║   ██║  ██║██║  ██║╚██████╗██║  ██╗
  ╚═══╝     ╚═╝   ╚═╝  ╚═╝       ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝
```

# vtx-track

**A local-first, privacy-first time tracker for your whole machine — with first-class depth for VS Code. Headless daemon, not Electron.**

[![CI](https://img.shields.io/github/actions/workflow/status/VTX-Labs/vtx-track/ci.yml?branch=main&color=3182ce)](https://github.com/VTX-Labs/vtx-track/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-3182ce.svg)](LICENSE)
[![Local-first](https://img.shields.io/badge/data-100%25%20local-3182ce.svg)](#privacy--data-ownership)
[![Platforms](https://img.shields.io/badge/Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-3182ce.svg)](#cross-platform-reality)

vtx-track watches where your time actually goes — every app, all day — and goes
*deep* on coding: per-folder, per-file, per-language, per-git-branch. It runs as
a tiny background **service** (a real OS daemon, not a 200&nbsp;MB Electron app),
keeps **everything on your machine**, and never phones home. No account, no
cloud, no telemetry.

> Think RescueTime's whole-day view + WakaTime's code detail — but the data
> never leaves your laptop, and you own every byte.

---

## Why it's different

- **Local-first, zero cloud.** No network calls in the hot path. The only data
  egress is an export *you* run or an end-to-end-encrypted sync server *you*
  host. This is the whole point.
- **Not Electron.** A headless Node daemon registered as a Windows Scheduled
  Task / macOS LaunchAgent / Linux systemd user unit. Tens of MB resident, not
  hundreds.
- **One timeline, no double-counting.** The daemon owns the clock. The VS Code
  extension and browser extension *enrich* that timeline with context (project,
  branch, file, domain) — they never run a second clock.
- **Smart idle.** Watching a video or sitting in a meeting doesn't count as
  "away" — and reports can tell focused work from passive time.
- **A real tray, not a window.** An optional native system-tray icon shows live
  status and gives one-click pause/resume and dashboard access — quitting it
  never stops tracking.
- **Honest about limits.** Wayland exposes no generic active-window API, so
  vtx-track ships per-compositor adapters (sway/i3, Hyprland, GNOME) and, where
  none applies, records window identity as `unknown` instead of fabricating it.

---

## What it tracks

| Layer | What you get |
| :---- | :----------- |
| **Whole machine** | Active app, window title (redactable), per-app and per-category time, idle vs active, meetings/videos as their own bucket. |
| **VS Code** | Time per workspace/project, per file, per language, per git branch; edit vs debug vs test vs terminal; active-typing vs editor-idle. |
| **Browser** | Per-domain time (e.g. `github.com` counts as Coding) — domains only, never full URLs, via an optional MV3 extension. |
| **Insights** | Day/week/month summaries, focus & context-switch metrics, deep-work streaks, goals & limits, standup summaries, billable timesheets. |

---

## Install

vtx-track is used by **cloning this repo and building from source.** It is *not*
published to npm, and there are no prebuilt installers or downloads — you run it
locally from your own checkout.

> Requires **Node ≥ 20** and **pnpm 10.x**.

```bash
git clone https://github.com/VTX-Labs/vtx-track.git
cd vtx-track
pnpm install          # installs deps + fetches native prebuilds
pnpm build            # build every package
node packages/cli/dist/cli.js start    # start the background daemon
node packages/cli/dist/cli.js today
```

That's the whole tracker. `node packages/cli/dist/cli.js` is the `vtx-track`
command — symlink or alias it (e.g. `alias vtx-track="node /path/to/vtx-track/packages/cli/dist/cli.js"`)
so you can just type `vtx-track <command>`.

### Optional components

Set any of these up after cloning and building:

#### CLI

The `vtx-track` commands (already built by `pnpm build`). It's the front door:
`start`, `stop`, `today`, `week`, `project`, `language`, `standup`, `timesheet`,
`export`, and more. See [`packages/cli/README.md`](packages/cli/README.md).

#### Dashboard

Open **http://127.0.0.1:7842/** in your browser while the daemon is running. The
daemon serves it; nothing extra to install.

#### Tray

A native system-tray icon with live status and one-click pause/resume:

```bash
node packages/tray/dist/main.js
# or: pnpm --filter @vtx-track/tray ...
```

#### VS Code extension

Build a local `.vsix` from source and install it into VS Code:

```bash
pnpm --filter vtx-track-vscode package       # produces a .vsix
code --install-extension packages/vscode/vtx-track-vscode-0.1.0.vsix
```

Or in VS Code: Command Palette → **Extensions: Install from VSIX…** and pick the
generated file. The extension enriches your timeline with per-project, per-file,
per-language, and per-branch data while you code.

#### Browser extension

Load [`apps/browser-extension`](apps/browser-extension) as an unpacked extension
in your browser (Chrome/Edge: `chrome://extensions` → Developer mode → *Load
unpacked*). Check that folder's README for the build step.

---

## The CLI

```text
Tracking
  start | stop | status        install/start, stop, or inspect the daemon
  pause | resume               pause or resume tracking
  tray                         run the system-tray companion

Reports
  today [--by app|category|project|language]
  week  [--by …]
  apps | project | language [--days N]
  focus [YYYY-MM-DD]           context-switching & deep-work metrics
  standup [YYYY-MM-DD]         a markdown standup summary
  timesheet [--by project --days N]   billable hours rollup

Data
  export [--format json|csv --days N]
  config get | set [--idle N --redaction full|apps-only|patterns --deny X]
  wipe --yes                   delete ALL tracked data
```

Full reference: [`packages/cli/README.md`](packages/cli/README.md).

---

## Architecture

A headless daemon owns the timeline; thin clients read from it and enrich it.

```
                 ┌───────────────────────────────────────────────┐
                 │  vtx-track DAEMON  (@vtx-track/daemon)          │
                 │  headless OS service — samples + owns timeline  │
                 │                                                 │
                 │  platform (native window+idle) → sessionizer →  │
                 │  categorize → privacy filter → SQLite (WAL)     │
                 │  localhost HTTP API (127.0.0.1) + IPC socket    │
                 └─▲──────────▲────────────▲──────────▲─────────▲──┘
     enrich/read   │          │            │          │         │
       ┌───────────┘    ┌─────┘      ┌─────┘     ┌────┘    ┌────┘
 ┌─────┴─────┐  ┌────────┴───┐  ┌─────┴────┐ ┌───┴─────┐ ┌─┴──────────┐
 │ VS Code   │  │ Browser    │  │   CLI    │ │  Tray   │ │ Dashboard   │
 │ extension │  │ extension  │  │vtx-track │ │  icon   │ │ localhost   │
 └───────────┘  └────────────┘  └──────────┘ └─────────┘ └─────────────┘
```

See [DESIGN.md](DESIGN.md) for the full architecture, SQLite schema, IPC
protocol, privacy model, and the cross-platform capability matrix.

---

## Packages

This is a pnpm workspace. Each package has its own README.

| Package | What it is |
| :------ | :--------- |
| [`@vtx-track/protocol`](packages/protocol) | Shared wire types + a typed daemon client. Zero deps. |
| [`@vtx-track/core`](packages/core) | Timeline engine: SQLite store, sessionizer, categorization, privacy filter, reporting. |
| [`@vtx-track/platform`](packages/platform) | Cross-OS active-window + idle behind one interface, incl. Wayland compositor adapters (sway/i3, Hyprland, GNOME). |
| [`@vtx-track/daemon`](packages/daemon) | The background service: sampler, HTTP API, IPC socket. |
| [`@vtx-track/service`](packages/service) | Install as a service (Windows Task Scheduler / launchd / systemd). |
| [`@vtx-track/cli`](packages/cli) | The `vtx-track` (alias `vtt`) command line. |
| [`@vtx-track/tray`](packages/tray) | Native system-tray companion: live status, pause/resume, open dashboard, quit. |
| [`vtx-track-vscode`](packages/vscode) | VS Code extension — enriches the timeline with project/branch/file context. |
| [`@vtx-track/dashboard`](packages/dashboard) | Minimal no-framework localhost dashboard (uPlot charts). |
| [`@vtx-track/integrations`](packages/integrations) | Export to WakaTime / Toggl / Clockify / CSV / JSON; git attribution. |
| [`@vtx-track/sync`](packages/sync) | Optional self-hosted, end-to-end-encrypted multi-machine sync. |
| [`apps/browser-extension`](apps/browser-extension) | MV3 extension for per-domain tab tracking. |

---

## Privacy & data ownership

Privacy isn't a setting here — it's the architecture.

- **100% local.** The daemon binds to `127.0.0.1` only. There is no telemetry and
  no third-party cloud. Your timeline lives in one SQLite file at
  `~/.vtx-track/vtx-track.db`.
- **You decide what's recorded.** A **denylist** drops chosen apps/sites entirely
  (password manager, banking). **Title redaction** has three modes —
  `apps-only` (default; drop titles), `patterns` (mask emails/tokens), or `full`.
- **Pause anytime.** `vtx-track pause` logs a private gap and records nothing
  until you resume.
- **Own your data.** `vtx-track export` (JSON/CSV) and `vtx-track wipe --yes`
  (delete everything) are first-class.
- **Sync is opt-in and end-to-end encrypted.** If you run your own
  [`@vtx-track/sync`](packages/sync) server, it only ever stores ciphertext — your
  passphrase never leaves your machine.

See [PRIVACY.md](PRIVACY.md) for the full model.

---

## Cross-platform reality

| Capability | Windows | macOS | Linux X11 | Linux Wayland |
| :--------- | :-----: | :---: | :-------: | :-----------: |
| Active app / process | ✅ | ✅ | ✅ | ✅ with adapter¹ |
| Window title | ✅ | ✅ (needs Screen Recording perm) | ✅ | ✅ with adapter¹ |
| Idle / AFK | ✅ | ✅ | ✅ | ✅ |
| Smart idle (video/meeting) | ➖ | ✅ | ✅ | ⚠️ |

¹ **Wayland** has no generic active-window API by design, so vtx-track talks to
the compositor directly: built-in adapters for **sway/i3** and **Hyprland** (via
their IPC sockets) and **GNOME** (via a bundled, read-only
[Shell extension](extensions/gnome)). On a compositor with no adapter, idle
tracking still works and window identity is recorded as `unknown` rather than
guessed — the dashboard explains the limitation.

---

## Development

```bash
pnpm install              # install + fetch native prebuilds
pnpm build                # build all packages (topological)
pnpm test                 # run every package's vitest suite (191 tests)
pnpm typecheck            # strict tsc across the workspace
pnpm --filter @vtx-track/daemon dev      # run the daemon from source
```

The stack: **Node/TypeScript** (strict), **pnpm workspaces**, **tsup** (ESM +
d.ts), **vitest**. Native: `@paymoapp/active-window`, `@paymoapp/real-idle`,
`better-sqlite3`, `systray2` (tray). Charts: `uPlot`. No Electron; bloat-free by
design.

### Troubleshooting native modules

vtx-track uses three native addons. A repo-root `postinstall`
([`scripts/fetch-native.mjs`](scripts/fetch-native.mjs)) fetches their prebuilt
binaries after install, with three escalating strategies: each addon's own
`prebuild-install`, then a direct download from the publisher's GitHub release,
then a source build (which needs a C/C++ toolchain — Xcode CLT on macOS,
build-essential on Linux, VS Build Tools on Windows).

You normally never have to think about this: if your npm/pnpm has
`ignore-scripts` enabled (so the postinstall is skipped), **the daemon fetches
the SQLite binding itself on first `start`** — a clean install just works. You
can also run the fetcher manually any time:

```bash
node scripts/native-bootstrap.mjs --list   # show what's resolved / missing
node scripts/fetch-native.mjs              # fetch anything missing
```

---

## Roadmap

- **v1 — local-first core** *(shipped)*: daemon, native tracking, VS Code
  enrichment, CLI, service install, dashboard.
- **v2 — insights** *(shipped)*: focus/context-switch metrics, deep-work streaks,
  goals & limits, standup + billable timesheets.
- **v3 — reach** *(shipped)*: browser extension, self-hosted encrypted sync,
  WakaTime/Toggl/Clockify export, git attribution.
- **v4 — desktop** *(shipped)*: native tray companion and Wayland compositor
  adapters (sway/i3, Hyprland, GNOME).

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

---

Built by [VTX Labs](https://vtxlabs.dev) · [GitHub](https://github.com/VTX-Labs/vtx-track) · [@vtxlabs](https://x.com/vtxlabs)
