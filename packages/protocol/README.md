# @vtx-track/protocol

**Shared wire types and a typed client for the [vtx-track](https://github.com/VTX-Labs/vtx-track) daemon.** Zero runtime dependencies.

This package is the contract between the daemon and every client (CLI, VS Code
extension, dashboard, integrations). It exports:

- **Domain types** — `Segment`, `ActivityState`, `VsCodeContext`, `Config`,
  `CategoryRule`, report shapes (`SummaryReport`, `FocusReport`, `StandupReport`,
  `TimesheetReport`), and the defaults (`DEFAULT_HTTP_PORT`, …).
- **`DaemonClient`** — a small, fully-typed HTTP client for the daemon's
  localhost API, plus `DaemonError` / `DaemonOfflineError`.

```ts
import { DaemonClient } from "@vtx-track/protocol";

const client = new DaemonClient(); // http://127.0.0.1:7842 by default

if (await client.isOnline()) {
  const today = await client.summary(
    { from: startOfDay, to: Date.now() },
    "category",
  );
  console.log(today.rows);
}
```

Read endpoints work without a token on localhost; control endpoints
(`pause`, `setConfig`, `wipe`) require the local control token from
`~/.vtx-track/token`.

---

Built by [VTX Labs](https://vtxlabs.dev) · [GitHub](https://github.com/VTX-Labs/vtx-track) · [@vtxlabs](https://x.com/vtxlabs)
