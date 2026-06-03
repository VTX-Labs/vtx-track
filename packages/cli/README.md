# @vtx-track/cli

**The `vtx-track` command line** (alias `vtt`) — start the tracker, see today and this week, per-project and per-language time, standups, timesheets, and export. All local.

This is the front door to vtx-track. It talks to the local [daemon](../daemon/README.md) over its `127.0.0.1` HTTP API (via [@vtx-track/protocol](../protocol/README.md)), formats the results for your terminal, and manages the background service through [@vtx-track/service](../service/README.md). See the [DESIGN.md](../../DESIGN.md) for how the pieces fit.

It is part of the vtx-track workspace and not published to npm.

## Invocation

```bash
vtx-track <command> [flags]   # the installed bin
vtt <command> [flags]         # short alias, identical
```

From source, inside the monorepo:

```bash
pnpm --filter @vtx-track/cli dev -- <command> [flags]
```

Run `vtx-track help` (or no command) for the built-in cheat sheet.

## Commands

### Tracking & service

| Command | What it does |
| --- | --- |
| `start` | Install the background service if needed, then start it. Tracking turns on. |
| `stop` | Stop the daemon service. |
| `restart` | Stop then start the service. |
| `install` | Install and start the service. |
| `uninstall` | Stop and remove the service. |
| `service [install\|uninstall\|start\|stop\|restart\|status]` | Service lifecycle, explicit form. Defaults to `status`. |
| `status` | Show daemon status: version, paused/tracking, platform, uptime, and whether window tracking is limited (e.g. Wayland). |
| `pause` | Pause tracking (control endpoint; needs the local token). |
| `resume` | Resume tracking. |

### Reports

| Command | Flags | What it does |
| --- | --- | --- |
| `today` | `--by app\|category\|project\|language` (default `category`) | Today's time, grouped. |
| `week` | `--by …` (default `category`) | Last 7 days, grouped. |
| `apps` | `--days N` (default 1) | Time by application. |
| `project` | `--days N` (default 1) | Time by project (VS Code workspace/repo). |
| `language` | `--days N` (default 1) | Time by language. |
| `focus` | `[YYYY-MM-DD]` (default today) | Context-switching and deep-work metrics for a day. |
| `standup` | `[YYYY-MM-DD]` (default today) | Markdown standup summary. |
| `timesheet` | `--by <dim>` (default `project`), `--days N` (default 7) | Billable-hours rollup. |

For `apps` / `project` / `language`, `--days 1` (the default) shows today; a larger value shows that many trailing days.

### Data

| Command | Flags | What it does |
| --- | --- | --- |
| `export` | `--format json\|csv` (default `json`), `--days N` (default 30) | Print raw segments to stdout. CSV columns: `started_at,ended_at,duration_ms,app,category,state,project,branch,language`. |
| `config get` | — | Print the current daemon config as JSON. Also the default when `config` is run with no subcommand. |
| `config set` | `--idle N`, `--redaction <full\|apps-only\|patterns>`, `--deny <value>` (repeatable) | Patch config. `--idle` sets the idle threshold in seconds; `--deny` may be passed multiple times to build the denylist. |
| `wipe` | `--yes` (required) | Delete **all** tracked data. Without `--yes` it refuses and prints how to confirm. |

### Meta

| Command | What it does |
| --- | --- |
| `help`, `--help`, `-h`, (no command) | Print usage. |
| `version`, `--version`, `-v` | Print the CLI version. |

## Environment variables

| Variable | Effect |
| --- | --- |
| `VTX_TRACK_PORT` | Port to reach the daemon on `127.0.0.1` (default `7842`). |
| `VTX_TRACK_HOME` | Root data directory (default `~/.vtx-track`). The control token is read from `<home>/token`. |

Read commands work without a token; control commands (`pause`, `resume`, `config set`, `wipe`) require the local control token, which the CLI reads automatically from `~/.vtx-track/token`.

## Exit codes

The CLI exits with a stable code so it composes in scripts:

| Code | Name | Meaning |
| --- | --- | --- |
| `0` | ok | Command succeeded. |
| `1` | usage | Bad command, unknown subcommand, or a required flag was missing (e.g. `wipe` without `--yes`). |
| `2` | offline | The daemon isn't running / couldn't be reached. |
| `3` | error | An unexpected error (including a failed service operation). |

When the daemon is offline, the CLI prints a friendly hint to run `vtx-track start` and returns `2`.

## Examples

```bash
# Turn tracking on (installs the background service on first run).
vtx-track start

# What did I do today, by category? And by project?
vtx-track today
vtx-track today --by project

# Last 7 days of apps; last 14 days by language.
vtx-track apps --days 7
vtx-track language --days 14

# Focus + deep-work metrics for a specific day.
vtx-track focus 2026-06-03

# Generate a standup you can paste into Slack.
vtx-track standup

# A billable timesheet: last 30 days, grouped by project.
vtx-track timesheet --by project --days 30

# Export the last 90 days to CSV.
vtx-track export --format csv --days 90 > activity.csv

# Tighten privacy: never log these apps, mask secrets in titles.
vtx-track config set --redaction patterns --deny "1Password" --deny "Bitwarden"

# Pause while doing something private, then resume.
vtx-track pause
vtx-track resume

# Talk to a daemon on a non-default port.
VTX_TRACK_PORT=9000 vtx-track status

# Nuke everything (irreversible).
vtx-track wipe --yes
```

## Local-first

The CLI only ever talks to `127.0.0.1`. Nothing leaves your machine; all data lives under `~/.vtx-track`. Optional cross-machine sync is opt-in and end-to-end encrypted — see [@vtx-track/sync](../sync/README.md).

---

Built by [VTX Labs](https://vtxlabs.dev) · [GitHub](https://github.com/VTX-Labs/vtx-track) · [@vtxlabs](https://x.com/vtxlabs)
