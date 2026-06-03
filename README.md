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
- **Honest about limits.** On Wayland the active window can't be read (the OS
  forbids it); vtx-track records that honestly instead of fabricating activity.

---

## What it tracks

| Layer | What you get |
| :---- | :----------- |
| **Whole machine** | Active app, window title (redactable), per-app and per-category time, idle vs active, meetings/videos as their own bucket. |
| **VS Code** | Time per workspace/project, per file, per language, per git branch; edit vs debug vs test vs terminal; active-typing vs editor-idle. |
| **Browser** | Per-domain time (e.g. `github.com` counts as Coding) — domains only, never full URLs, via an optional MV3 extension. |
| **Insights** | Day/week/month summaries, focus & context-switch metrics, deep-work streaks, goals & limits, standup summaries, billable timesheets. |

---

## Quick start

> Requires **Node ≥ 20** and **pnpm**. This is a source-first monorepo (it is not
> published to npm); you run it from a clone.

```bash
git clone https://github.com/VTX-Labs/vtx-track.git
cd vtx-track
pnpm install          # installs deps + fetches native prebuilds (see Troubleshooting)
pnpm build            # build every package

# Start tracking (installs the background service for your OS):
node packages/cli/dist/cli.js start

# See where your time went:
node packages/cli/dist/cli.js today
node packages/cli/dist/cli.js status
```

Once installed you can link the CLI bin so `vtx-track` (alias `vtt`) is on your
PATH:

```bash
pnpm --filter @vtx-track/cli exec npm link   # optional convenience
vtx-track today --by project
```

Open the dashboard at **http://127.0.0.1:7842/** while the daemon is running.

---

## The CLI

```text
Tracking
  start | stop | status        install/start, stop, or inspect the daemon
  pause | resume               pause or resume tracking

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
                 └──▲────────────▲─────────────▲────────────▲──────┘
       enrich/read  │            │             │            │
        ┌───────────┘     ┌──────┘       ┌─────┘      ┌──────┘
   ┌────┴──────┐   ┌───────┴────┐   ┌─────┴────┐  ┌────┴──────────┐
   │ VS Code   │   │ Browser    │   │   CLI    │  │  Dashboard     │
   │ extension │   │ extension  │   │vtx-track │  │  localhost web │
   └───────────┘   └────────────┘   └──────────┘  └────────────────┘
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
| [`@vtx-track/platform`](packages/platform) | Cross-OS active-window + idle behind one interface, with the honest Wayland fallback. |
| [`@vtx-track/daemon`](packages/daemon) | The background service: sampler, HTTP API, IPC socket. |
| [`@vtx-track/service`](packages/service) | Install as a service (Windows Task Scheduler / launchd / systemd). |
| [`@vtx-track/cli`](packages/cli) | The `vtx-track` (alias `vtt`) command line. |
| [`@vtx-track/vscode`](packages/vscode) | VS Code extension — enriches the timeline with project/branch/file context. |
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
| Active app / process | ✅ | ✅ | ✅ | ⚠️ limited |
| Window title | ✅ | ✅ (needs Screen Recording perm) | ✅ | ❌ (OS forbids) |
| Idle / AFK | ✅ | ✅ | ✅ | ✅ |
| Smart idle (video/meeting) | ➖ | ✅ | ✅ | ⚠️ |

On Wayland, vtx-track records window identity as `unknown` rather than guessing;
idle tracking still works, and the dashboard explains the limitation.

---

## Development

```bash
pnpm install              # install + fetch native prebuilds
pnpm build                # build all packages (topological)
pnpm test                 # run every package's vitest suite
pnpm typecheck            # strict tsc across the workspace
pnpm --filter @vtx-track/daemon dev      # run the daemon from source
```

The stack: **Node/TypeScript** (strict), **pnpm workspaces**, **tsup** (ESM +
d.ts), **vitest**. Native: `@paymoapp/active-window`, `@paymoapp/real-idle`,
`better-sqlite3`. Charts: `uPlot`. No Electron; bloat-free by design.

### Troubleshooting native modules

vtx-track uses three native addons. A repo-root `postinstall`
([`scripts/fetch-native.mjs`](scripts/fetch-native.mjs)) fetches their prebuilt
binaries automatically after `pnpm install`. If it can't find a prebuilt binary
for your platform/Node version it falls back to compiling from source, which
needs a C/C++ toolchain (Xcode CLT on macOS, build-essential on Linux, VS Build
Tools on Windows). Re-run it any time with `node scripts/fetch-native.mjs`.

---

## Roadmap

- **v1 — local-first core** *(shipped)*: daemon, native tracking, VS Code
  enrichment, CLI, service install, dashboard.
- **v2 — insights** *(shipped)*: focus/context-switch metrics, deep-work streaks,
  goals & limits, standup + billable timesheets.
- **v3 — reach** *(shipped)*: browser extension, self-hosted encrypted sync,
  WakaTime/Toggl/Clockify export, git attribution.
- **Planned**: native tray companion, Wayland compositor adapters, packaged
  installers (MSI / pkg / deb).

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

---

Built by [VTX Labs](https://vtxlabs.dev) · [GitHub](https://github.com/VTX-Labs/vtx-track) · [@vtxlabs](https://x.com/vtxlabs)
