# @vtx-track/dashboard

**A minimal, no-framework localhost dashboard for [vtx-track](https://github.com/VTX-Labs/vtx-track).** Vanilla TypeScript plus [uPlot](https://github.com/leeoniya/uPlot) for charts — no React, no Vue, no build-time framework. The whole UI is one small bundle the daemon serves from `127.0.0.1`.

It shows your day at a glance: time by category and app, a timeline of when you were active, focus metrics (context switches and deep-work), top projects and languages, and a standup preview you can copy.

> Screenshot placeholder — drop a `docs/dashboard.png` here once captured.

## What it is

This package ships two things:

1. **A static handler for the daemon.** `createStaticHandler()` returns a Node `http` request handler that serves the built UI assets out of this package's `dist/public/`. The daemon imports it dynamically and mounts it; if the package isn't installed, the daemon simply runs headless.
2. **The UI itself.** `public/index.html`, a bundled `app.js` (vanilla TS + uPlot), and `styles.css`, all emitted to `dist/public/`.

## How it's served

You don't run this package directly. The daemon loads it:

```ts
// inside @vtx-track/daemon
const mod = await import("@vtx-track/dashboard");
const serveStatic = mod.createStaticHandler?.();
```

`createStaticHandler()` returns a function `(req, res) => boolean`:

- It serves `GET`/`HEAD` requests for files under `dist/public/`, with correct content-types and path-traversal protection.
- `/` and `/dashboard` map to `index.html`.
- It returns `false` for anything it doesn't handle, so the daemon's API routes and 404 still work.

With the daemon running, open the dashboard at:

```
http://127.0.0.1:7842/        (or /dashboard)
```

## Endpoints it uses

The UI talks to the daemon's localhost HTTP API (read endpoints, no token needed on localhost; CORS is enabled by the daemon):

| Endpoint | Used for |
| :------- | :------- |
| `GET /health` | online state, platform, and the "limited on Wayland" note |
| `GET /report/summary?from&to&by` | by-category, by-app, top-projects, top-languages bars |
| `GET /report/timeline?from&to` | the active-minutes timeline chart |
| `GET /report/focus?date` | focus cards (context switches, deep-work) |
| `GET /report/standup?date` | the standup preview |

The range switcher (**Today / 7d / 30d**) just changes the `from`/`to` window. Focus and standup are per-day, so they populate when **Today** is selected.

## Local-first

Nothing leaves your machine. The dashboard is served from `127.0.0.1` by your own daemon and only ever fetches from that same origin. There is no telemetry and no external CDN — uPlot is bundled in. When the daemon isn't reachable, the page shows a friendly "daemon offline" state instead of breaking. On Wayland (where the compositor hides window titles), it surfaces a one-time "limited on Wayland" note.

## Build

```bash
pnpm --filter @vtx-track/dashboard build
```

This runs two steps:

- **tsup** compiles the Node server entry (`src/index.ts`) to `dist/index.js` + `dist/index.d.ts`.
- **build.mjs** (esbuild) bundles `src/app.ts` (with uPlot) to `dist/public/app.js` and copies `index.html`, `styles.css`, and uPlot's CSS into `dist/public/`.

Output:

```
dist/
  index.js          ← server entry (createStaticHandler)
  index.d.ts
  public/
    index.html
    app.js          ← bundled vanilla-TS UI + uPlot
    styles.css
    uplot.css
```

Other scripts: `pnpm --filter @vtx-track/dashboard typecheck`, `pnpm --filter @vtx-track/dashboard test`.

---

Built by [VTX Labs](https://vtxlabs.dev) · [GitHub](https://github.com/VTX-Labs/vtx-track) · [@vtxlabs](https://x.com/vtxlabs)
