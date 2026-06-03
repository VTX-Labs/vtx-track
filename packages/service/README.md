# @vtx-track/service

**Install the [vtx-track](https://github.com/VTX-Labs/vtx-track) daemon as a background service** — across Windows, macOS, and Linux, with one API.

This package registers the [daemon](../daemon/README.md) with the operating system's own service mechanism so it starts at login and stays alive across crashes and reboots — without staying attached to a terminal and without (on the common paths) needing admin rights. The [CLI](../cli/README.md)'s `start` / `stop` / `install` commands are thin wrappers over this package. See [DESIGN.md](../../DESIGN.md) for the overall architecture.

It is part of the vtx-track workspace and consumed via `workspace:*`; it is not published to npm.

## Per-platform mechanism

| Platform | Mechanism | Where it lives |
| --- | --- | --- |
| Windows | Task Scheduler (`schtasks`) | task `vtx-track`, definition XML in `~/.vtx-track` |
| macOS | launchd LaunchAgent (`launchctl`) | `~/Library/LaunchAgents/dev.vtxlabs.track.plist` |
| Linux | systemd **user** unit (`systemctl --user`) | `~/.config/systemd/user/vtx-track.service` |
| Other | unsupported (install/start throw a clear error) | — |

All three are **per-user**, no-admin paths to an always-on background process. The Windows task triggers on logon and restarts on failure; the launchd agent uses `RunAtLoad` + `KeepAlive`; the systemd unit uses `Restart=on-failure` and `WantedBy=default.target`.

## API

The high-level functions resolve the right manager for the current platform and delegate to it:

```ts
import {
  installService,   // install + enable + start
  uninstallService, // stop + remove
  startService,     // start an already-installed service
  stopService,      // stop the running service
  serviceStatus,    // query install/run state
} from "@vtx-track/service";

await installService();
const state = await serviceStatus();
// → { installed: true, running: true, manager: "systemd" }
await stopService();
await uninstallService();
```

`serviceStatus()` returns a `ServiceState`:

```ts
interface ServiceState {
  installed: boolean;
  running: boolean;
  manager: "windows-task" | "launchd" | "systemd" | "unsupported";
}
```

### Lower-level building blocks

```ts
import {
  createServiceManager,                       // pick the manager for this OS
  LaunchdManager, SystemdManager, WindowsTaskManager,
  serviceSpec, resolveDaemonPath,             // resolve node + daemon entry paths
  launchdPlist, systemdUnit, windowsTaskXml,  // render the raw service definitions
  SERVICE_LABEL,                              // "dev.vtxlabs.track"
} from "@vtx-track/service";

console.log(systemdUnit(serviceSpec())); // inspect the unit that would be written
```

`serviceSpec()` builds a `ServiceSpec` (`nodePath`, `daemonPath`, `logPath`, `label`). `resolveDaemonPath()` resolves the daemon's `dist/main.js` from the installed `@vtx-track/daemon` package, falling back to the `vtx-track-daemon` bin on `PATH`. The definition renderers are pure string functions — handy for previewing or auditing exactly what gets installed.

## Behaviour notes

- **`startService()` on Windows/macOS** is part of `install()`; the systemd path enables with `--now`. The CLI's `start` command installs-if-needed and then starts, so a first run "just works".
- The Windows task XML is written as **UTF-16LE with a BOM**, which `schtasks /Create /XML` requires; the manager handles the encoding.
- Managers shell out with `shell: false` and never throw on non-zero exit when querying status — `status()` reports honestly instead.
- Logs go to the daemon log file (`~/.vtx-track/daemon.log`) on all platforms.

## Privilege note

The per-user mechanisms above do not require elevation. If a service operation fails with a permissions error, the CLI surfaces a hint — installing under a system-wide manager (rather than the per-user defaults here) is what would need elevated privileges.

---

Built by [VTX Labs](https://vtxlabs.dev) · [GitHub](https://github.com/VTX-Labs/vtx-track) · [@vtxlabs](https://x.com/vtxlabs)
