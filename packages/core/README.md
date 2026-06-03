# @vtx-track/core

**The [vtx-track](https://github.com/VTX-Labs/vtx-track) timeline engine** — the local SQLite store, sessionizer, categorization, privacy filter, and reporting. Local-first, no network.

This package is the pure, headless brain of vtx-track. The [daemon](../daemon/README.md) feeds it observations and it owns everything that turns raw activity samples into a queryable, categorized, privacy-filtered timeline on disk. It has no clock and opens no sockets — it is a library the daemon, CLI, and dashboard build on. See [DESIGN.md](../../DESIGN.md) for the full architecture, schema, and pipeline.

The processing pipeline is: a sample is run through the **privacy filter**, then the **categorizer**, then folded by the **sessionizer** into closed segments, which the **store** writes to SQLite. Reports read those segments back.

## What it exports

| Area | Exports |
| --- | --- |
| Paths | `dataDir`, `defaultDbPath`, `configPath`, `tokenPath`, `socketPath`, `pidPath`, `logPath` |
| Config | `defaultConfig`, `loadConfig`, `saveConfig`, `mergeConfig` |
| Categorization | `Categorizer`, `UNCATEGORIZED`, `DEFAULT_CATEGORY_COLORS` |
| Privacy | `PrivacyFilter`, `PrivacyDecision` |
| Sessionizing | `Sessionizer`, `effectiveState`, `MIN_SEGMENT_MS`, `Observation`, `PendingSegment` |
| Store | `Store` |
| Reporting | `summarize`, `focusMetrics`, `standup`, `timesheet`, `fmtDuration` |
| Time helpers | `startOfDay`, `endOfDay`, `toDateString`, `fromDateString`, `dayRange`, `lastNDays` |

It is part of the vtx-track workspace and consumed via `workspace:*`; it is not published to npm.

## The store

`Store` owns the schema and every read/write of the timeline. It opens SQLite in **WAL mode** (with `synchronous = NORMAL` and foreign keys on) so the CLI and dashboard can read while the daemon writes, and runs versioned migrations on open keyed on SQLite's `user_version`.

```ts
import { Store, defaultDbPath } from "@vtx-track/core";

const store = new Store(defaultDbPath()); // creates the file + schema on first open

const segments = store.segmentsBetween(from, to); // all segments overlapping [from, to)
store.logEvent(Date.now(), "paused");             // append to the audit log
const removed = store.wipe();                      // delete everything; returns segment count
store.close();
```

The schema seeds the built-in categories and stores a stable per-machine `host` id in a `meta` table. Apps and categories are upserted; VS Code and browser context are stored in side tables joined back on read.

## Sessionizer

`Sessionizer` is pure and synchronous. You feed it `Observation`s in time order and it emits a `PendingSegment` whenever the active context meaningfully changes (different app, title, category, state, or VS Code context). Call `flush(now)` when the daemon stops to emit the trailing open segment.

```ts
import { Sessionizer, effectiveState } from "@vtx-track/core";

const sessionizer = new Sessionizer(/* minSegmentMs */ 1000);

const segment = sessionizer.push(observation); // a closed segment, or null
// … later, on shutdown:
const tail = sessionizer.flush(Date.now());
```

Segments shorter than `minSegmentMs` (default `MIN_SEGMENT_MS`, 1000 ms) are dropped as focus flicker. State is derived from the idle reading: `active` / `idlePrevented` accrue to the app; `idle`, `locked`, and `private` (paused/denylisted) collapse into single continuous gap segments with no app attribution; `unknown` is recorded honestly (e.g. Wayland can't name the window).

## Categorization

`Categorizer` resolves a category for a window sample. Priority, most specific first:

1. **User rules** (from config) — always win, matched on app, exe glob, title regex, or domain.
2. **Default domain rules** when a browser domain is present — so `github.com` is `Coding` even though the app is a generic browser.
3. **Built-in app rules** — a conservative set covering editors, terminals, comms, meetings, browsers, design, writing, and entertainment apps.

Unmatched activity falls back to `UNCATEGORIZED` (`"Uncategorized"`). `DEFAULT_CATEGORY_COLORS` maps each built-in category to a dashboard colour.

```ts
import { Categorizer } from "@vtx-track/core";

const categorizer = new Categorizer(config.categoryRules);
const category = categorizer.categorize(sample, "github.com"); // "Coding"
```

## Privacy filter

`PrivacyFilter` is applied to a sample **before** it is persisted. It decides whether to record at all and what to do with the title.

- **Denylist** — if the app name or domain matches (case-insensitive substring) the segment is denied entirely.
- **Redaction** — `full` keeps titles, `apps-only` drops them, `patterns` masks built-in + user-supplied regexes (built-ins cover emails, `key=value` secrets, and long opaque tokens).

```ts
import { PrivacyFilter } from "@vtx-track/core";

const filter = new PrivacyFilter(config);
const { denied, title } = filter.apply(sample, domain);
```

## Reporting

All report functions ignore idle/locked/private gaps — only `active` and `idlePrevented` time counts as time spent.

```ts
import { summarize, focusMetrics, standup, timesheet, fmtDuration } from "@vtx-track/core";

summarize(segments, from, to, "category");   // grouped totals with share-of-time
focusMetrics(segments, "2026-06-03");          // context switches + deep-work spans (>= 25m)
standup(segments, "2026-06-03");               // markdown standup + per-project breakdown
timesheet(segments, from, to, "project");      // billable hours rollup, rounded to 2dp
fmtDuration(8_040_000);                         // "2h 14m"
```

Grouping dimensions are `app`, `category`, `project` (VS Code workspace/repo), `language`, and `branch`.

## Config and paths

`defaultConfig()` is the shipped configuration; `loadConfig()` reads `~/.vtx-track/config.json`, filling any missing keys from defaults (a malformed or absent file yields defaults rather than throwing, so the daemon always starts). All paths live under `~/.vtx-track`, overridable with the `VTX_TRACK_HOME` environment variable.

## Local-first

The store never touches the network. Everything — segments, config, the audit log — lives in a single SQLite file under `~/.vtx-track` on the machine that recorded it. Optional cross-machine sync is opt-in and end-to-end encrypted; see [@vtx-track/sync](../sync/README.md).

---

Built by [VTX Labs](https://vtxlabs.dev) · [GitHub](https://github.com/VTX-Labs/vtx-track) · [@vtxlabs](https://x.com/vtxlabs)
