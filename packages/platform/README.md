# @vtx-track/platform

**Cross-platform active-window and idle detection for [vtx-track](https://github.com/VTX-Labs/vtx-track), behind one interface.** Windows, macOS, Linux (X11) — with an honest Wayland fallback.

This package is the only part of vtx-track that touches native OS APIs. It wraps `@paymoapp/active-window` (foreground window) and `@paymoapp/real-idle` (idle / lock / idle-prevented state) behind a single `ActivityMonitor` interface, so the [daemon](../daemon/README.md) never has to know which platform it's on. See [DESIGN.md](../../DESIGN.md) for where this sits in the system.

Its defining principle is **honesty about limitations**: rather than silently recording bad data when the OS won't tell us what we need, it resolves a capability set up front and degrades gracefully, annotating *why*.

It is part of the vtx-track workspace and consumed via `workspace:*`; it is not published to npm.

## Usage

```ts
import { createMonitor, describeCapabilities } from "@vtx-track/platform";

const monitor = await createMonitor();
monitor.start(); // initializes native resources, requests macOS permissions if needed

const sample = monitor.getActiveWindow();        // WindowSample | null
const idle = monitor.getIdle(120);               // IdleReading for a 120s threshold

const unsubscribe = monitor.onWindowChange((s) => {
  console.log("foreground changed:", s?.app);
});

// … on shutdown:
unsubscribe();
monitor.stop();
```

`createMonitor()` **never throws**. It picks the best implementation for the environment and, if everything is unavailable, still returns a working (idle-less) monitor so the daemon can run and report its own limitations.

## The `ActivityMonitor` interface

| Member | Purpose |
| --- | --- |
| `capabilities` | The `PlatformCapabilities` resolved for this environment |
| `start()` | Initialize native resources, request permissions |
| `getActiveWindow()` | Read the foreground window synchronously (`WindowSample \| null`) |
| `getIdle(thresholdSeconds)` | Read current idle state (`IdleReading`) |
| `onWindowChange(listener)` | Subscribe to foreground changes; returns an unsubscribe fn |
| `stop()` | Release native resources |

Two implementations back it:

- **`NativeMonitor`** — the production path on Windows, macOS, and Linux/X11 when the native addons load. On macOS it uses `osxRunLoop: "all"` so subscriptions fire in a headless daemon and requests Screen Recording permission on start.
- **`DegradedMonitor`** — used on Wayland or when the active-window addon fails to load. It returns `null` for the active window but **still performs idle accounting** when a real-idle addon is present.

## Capabilities

`describeCapabilities()` (and each monitor's `capabilities`) returns a `PlatformCapabilities` object — the single source of truth for what vtx-track can observe here:

| Flag | Meaning |
| --- | --- |
| `platform` | The Node platform string |
| `canIdentifyWindow` | Can we identify the active window/app at all? |
| `canReadTitles` | Can we read window titles? |
| `canReadIdle` | Can we read idle time? |
| `canDetectIdlePrevented` | Can we detect video/meeting "idle prevented" state? |
| `canDetectLock` | Can we detect a locked session? |
| `limitationNote` | Human-readable reason for any limitation, for surfacing to users |

Resolved per platform:

| Platform | Identify window | Titles | Idle | Idle-prevented | Lock |
| --- | --- | --- | --- | --- | --- |
| Windows | yes | yes | yes | no | no |
| macOS | yes | yes¹ | yes | yes | yes |
| Linux (X11) | yes | yes | yes | yes | no |
| Linux (Wayland) | **no** | **no** | **yes** | yes | no |
| Other | no | no | no | no | no |

¹ macOS requires **Screen Recording** permission to read window titles (System Settings → Privacy & Security → Screen Recording).

## The honest Wayland fallback

Wayland's security model forbids one application from reading another's window or title — there is no API for it, by design. vtx-track does not try to work around this. On Wayland, `resolveCapabilities` reports `canIdentifyWindow: false` / `canReadTitles: false` with a `limitationNote` explaining why, and `createMonitor` returns a `DegradedMonitor`.

The important part: **idle tracking still works**. Whole-day active/idle/locked accounting is preserved even though app-level tracking is off, because real-idle reads through a different mechanism. App-level tracking on Linux requires X11 or a compositor adapter.

## Troubleshooting

If `canIdentifyWindow` is unexpectedly false on a supported platform, the active-window native addon failed to load (the `limitationNote` will say so). Reinstall dependencies so the prebuilt/native binding for your OS and Node version is present.

---

Built by [VTX Labs](https://vtxlabs.dev) · [GitHub](https://github.com/VTX-Labs/vtx-track) · [@vtxlabs](https://x.com/vtxlabs)
