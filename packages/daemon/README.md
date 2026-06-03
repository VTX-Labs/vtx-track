# @vtx-track/daemon

**The [vtx-track](https://github.com/VTX-Labs/vtx-track) background daemon** — samples activity, owns the timeline, and serves a localhost API + IPC socket. Headless. Not Electron.

The daemon is the single source of truth for the timeline. It:

- subscribes to foreground-window changes and runs a 5s heartbeat (event-driven + heartbeat sampling);
- reads idle/lock/idle-prevented state (so videos and meetings don't count as AFK);
- folds samples through privacy → categorization → the sessionizer, then writes segments to local SQLite;
- accepts VS Code / browser **enrichment** by pid so IDE context decorates the timeline without a second clock;
- serves a token-gated HTTP API on `127.0.0.1` and an IPC socket (named pipe on Windows, unix socket elsewhere).

```bash
# Run directly (normally launched by @vtx-track/service):
vtx-track-daemon
# → vtx-track daemon 0.1.0 listening on http://127.0.0.1:7842
```

```ts
import { Daemon } from "@vtx-track/daemon";

const daemon = await Daemon.create();
await daemon.start();
// … later
await daemon.stop();
```

See [DESIGN.md](../../DESIGN.md) for the full architecture, schema, and API.

---

Built by [VTX Labs](https://vtxlabs.dev) · [GitHub](https://github.com/VTX-Labs/vtx-track) · [@vtxlabs](https://x.com/vtxlabs)
