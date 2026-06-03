# @vtx-track/browser-extension

**A Manifest V3 browser extension that gives [vtx-track](https://github.com/VTX-Labs/vtx-track) tab-granularity time tracking — by reporting the active tab's _domain only_ to your local daemon.** Localhost only, no telemetry.

The daemon already times "the browser is the foreground app." This extension
_enriches_ that segment with the active tab's registrable domain (e.g.
`github.com`), mirroring how the VS Code extension enriches its window — the
extension keeps no clock of its own.

## Privacy

Privacy is the whole point of this extension:

- **Domain only, never the full URL.** The path, query string, and fragment are
  stripped before anything leaves the page. `https://www.github.com/VTX-Labs/x?q=1`
  becomes `github.com`.
- **Localhost only.** The only network request is `POST http://127.0.0.1:7842/context/browser`
  on your own machine. There is no cloud, no telemetry, and no other egress.
- **Tab titles off by default.** You can opt in on the Settings page; even then,
  only the title is added — never a URL path or query.
- **Denylist.** Block any domain (and its subdomains) from ever being reported.
- **One-click pause.** The popup pauses all reporting instantly.

The wire payload is exactly `{ pid, domain, tabTitle? }`
(`@vtx-track/protocol`'s `BrowserContext`).

## Build

From the repo root:

```sh
pnpm install
pnpm --filter @vtx-track/browser-extension build
```

This bundles `src/*.ts` → `dist/*.js` with esbuild (target `chrome111`) and
copies `manifest.json` + the HTML pages into `dist/`. Other scripts:

```sh
pnpm --filter @vtx-track/browser-extension typecheck   # tsc --noEmit
pnpm --filter @vtx-track/browser-extension test         # vitest (domain helper)
```

## Load unpacked (Chrome / Edge / Brave)

1. Run the build (above) to produce `dist/`.
2. Open `chrome://extensions` (or `edge://extensions`).
3. Toggle **Developer mode** on.
4. Click **Load unpacked** and select the `dist/` folder.
5. Pin the extension and open the popup to confirm the tracked domain. Open
   **Settings** to manage the denylist and tab-title option.

Make sure the vtx-track daemon is running on `127.0.0.1:7842`. If it is offline
the extension simply reports nothing (it fails silently by design).

> **Icons are placeholders.** `manifest.json` references `icons/icon-{16,32,48,128}.png`,
> but no PNG binaries ship in this repo. The build copies `icons/` into `dist/`
> only if you add real files there; otherwise Chrome falls back to a generated
> default icon, which is fine for local development.

## Limitations (v1)

- **`pid` is always `-1`.** A browser extension cannot reliably learn its own OS
  process id from the sandbox, so the daemon attaches this context by matching
  the foreground browser process rather than by pid. A future native-messaging
  bridge can supply the real pid.
- **Heartbeat granularity.** Chrome's `chrome.alarms` minimum period is ~1
  minute, so the periodic re-assert runs every minute; tab/window switches are
  reported immediately via events.

## Layout

| Path | Role |
| :--- | :--- |
| `src/domain.ts` | Pure, unit-tested `registrableDomain` / `isDenied` helpers. |
| `src/settings.ts` | Typed `chrome.storage.sync` wrapper + the `BrowserContext` wire shape. |
| `src/background.ts` | MV3 service worker: watches tabs/windows + alarm heartbeat, POSTs to the daemon. |
| `src/popup.ts` + `popup.html` | Current domain + pause toggle. |
| `src/options.ts` + `options.html` | Tracking toggle, denylist editor, tab-title opt-in. |
| `build.mjs` | esbuild bundle + static-asset copy. |

---

Built by [VTX Labs](https://vtxlabs.dev) · [GitHub](https://github.com/VTX-Labs/vtx-track) · [@vtxlabs](https://x.com/vtxlabs)
