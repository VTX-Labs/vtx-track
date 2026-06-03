# @vtx-track/integrations

**Export/import adapters for [vtx-track](https://github.com/VTX-Labs/vtx-track).** Pure, local-first transforms — no network calls, no API keys.

Turn your local segments into the shapes other tools speak (WakaTime, Toggl,
Clockify), dump them to CSV/JSON, or attribute time across git branches and
repos. Every function is a deterministic pure transform you can run offline.

## Install

```sh
pnpm add @vtx-track/integrations
```

## Usage

```ts
import {
  toWakatimeHeartbeats,
  toTogglEntries,
  toClockifyEntries,
  toCsv,
  toTimesheetCsv,
  toJson,
  fromJson,
  attributeToBranches,
  attributeToRepos,
} from "@vtx-track/integrations";
import type { Segment } from "@vtx-track/protocol";

declare const segments: Segment[];

// WakaTime-style heartbeats (entity = file or app, time in epoch seconds).
const heartbeats = toWakatimeHeartbeats(segments);

// Toggl / Clockify time entries (consecutive same-project segments merged).
const toggl = toTogglEntries(segments);
const clockify = toClockifyEntries(segments);

// CSV / JSON round-trips.
const csv = toCsv(segments);
const restored = fromJson(toJson(segments)); // throws MalformedSegmentError on bad input

// Git attribution: milliseconds per branch / repo.
const perBranch: Map<string, number> = attributeToBranches(segments);
const perRepo: Map<string, number> = attributeToRepos(segments);
```

### Timesheet CSV

Pair with `@vtx-track/core`'s `timesheet()` to produce a billable CSV:

```ts
import { timesheet } from "@vtx-track/core";
import { toTimesheetCsv } from "@vtx-track/integrations";

const report = timesheet(segments, from, to, "project");
const csv = toTimesheetCsv(report); // key, durationMs, duration, hours + TOTAL row
```

## API

| Function | Output |
| --- | --- |
| `toWakatimeHeartbeats(segments)` | `WakatimeHeartbeat[]` |
| `toTogglEntries(segments)` | `TogglEntry[]` (merged by project) |
| `toClockifyEntries(segments)` | `ClockifyEntry[]` (merged by project) |
| `toCsv(segments)` | RFC 4180 CSV string |
| `toTimesheetCsv(report)` | CSV string from a `TimesheetReport` |
| `toJson(segments)` / `fromJson(text)` | JSON string / validated `Segment[]` |
| `attributeToBranches(segments)` | `Map<branch, ms>` |
| `attributeToRepos(segments)` | `Map<repo, ms>` |

---

Built by [VTX Labs](https://vtxlabs.dev) · [GitHub](https://github.com/VTX-Labs/vtx-track) · [@vtxlabs](https://x.com/vtxlabs)
