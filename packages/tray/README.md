# @vtx-track/tray

The system-tray companion for [vtx-track](https://github.com/VTX-Labs/vtx-track) —
a small native tray icon that shows live tracking status and gives you one-click
control without opening a terminal.

It is a thin remote control for the local daemon over its localhost API. It
keeps **no** tracking state of its own, so quitting the tray never stops
tracking — the daemon keeps running as a background service.

## What it shows

- **● tracking** / **❙❙ paused** / **● daemon offline** — live status, refreshed
  every few seconds.
- **Pause / Resume tracking** — toggles the daemon (disabled while offline).
- **Open dashboard** — opens the local dashboard (`http://127.0.0.1:7842/`) in
  your default browser.
- **Quit tray** — closes the icon only; tracking continues.

## Usage

The tray ships with the CLI:

```sh
vtx-track tray
```

Or run the bundled binary directly:

```sh
vtx-track-tray
```

It runs in the foreground (close the window or press Ctrl+C to quit). To have it
start automatically at login, the OS service layer (`@vtx-track/service`) can
register it alongside the daemon.

## How it works

The tray uses [`systray2`](https://www.npmjs.com/package/systray2), which ships a
tiny prebuilt helper binary for Windows, macOS and Linux — no compiler needed.
The Node process talks to that helper over stdio to draw the icon and menu, and
talks to the vtx-track daemon over HTTP to read status and send pause/resume.

The control endpoints require the local daemon token, which the tray reads from
`~/.vtx-track/token` (same machine only). Status (`/health`) needs no token.

## API

The package also exports a small programmatic surface:

```ts
import { Tray, buildMenuItems } from "@vtx-track/tray";

const tray = new Tray({ pollMs: 5000 });
await tray.start();
// …
await tray.stop();
```

- `Tray` — the controller. Options: `daemon` (inject a client), `dashboardUrl`,
  `pollMs`, `openUrl` (inject the browser opener — handy for tests).
- `buildMenuItems(state)` — pure function mapping a `TrayState` to menu items.

## License

MIT © VTX Labs
