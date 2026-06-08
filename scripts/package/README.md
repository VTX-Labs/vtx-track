# Packaging vtx-track

These scripts build the **packaged installers** so non-developers can install
vtx-track without Node or pnpm. Each installer wraps the same self-contained app
tree produced by `stage.mjs`.

## The stage step (`stage.mjs`)

`node scripts/package/stage.mjs` builds every runtime package, ensures the
prebuilt native addons are present, and assembles a flat, pnpm-free app tree at
`dist-stage/app/`:

```
dist-stage/app/
  node_modules/        # @vtx-track/* + vendored runtime deps, flat layout
    better-sqlite3/build/Release/better_sqlite3.node
    @paymoapp/*/build/Release/*.node
    systray2/traybin/*
  bin/                 # vtx-track, vtx-track-daemon, vtx-track-tray launchers
  STAGE.json
```

This tree runs with a bare `node`, no pnpm symlinks. It is the input to all
three installers.

## Per-OS installers

| Installer | Script | Builds on | Installs to | Service |
|-----------|--------|-----------|-------------|---------|
| **MSI** (Windows) | `windows/build-msi.mjs` | Windows | `%LOCALAPPDATA%\Programs\vtx-track` | Scheduled Task |
| **pkg** (macOS) | `macos/build-pkg.mjs` | macOS | `/usr/local/vtx-track` | launchd agent |
| **deb** (Linux) | `linux/build-deb.mjs` | Linux | `/opt/vtx-track` | systemd `--user` |

### Why each must build on its own OS

The staged tree contains the **prebuilt native binaries for the host platform**
(`better-sqlite3`, the `@paymoapp` addons). A Linux `.deb` must therefore be
built on Linux, the macOS `.pkg` on macOS, and the Windows `.msi` on Windows.
That is what `.github/workflows/release.yml` does — it runs each builder on a
matching GitHub runner and attaches the result to the release.

- **MSI** bundles a pinned Node runtime, so the installed Windows app needs no
  system Node. (WiX 5 — `dotnet tool install --global wix --version 5.0.2`.)
- **pkg** and **deb** declare a dependency on the system Node (`>= 20`) rather
  than bundling it, following platform convention.

### Verification status

- The **MSI** builder is exercised and verified on Windows: it produces a valid
  installer database containing the bundled Node, the native addons, and the
  CLIs.
- The **pkg** and **deb** builders assemble their full payload trees in a
  cross-platform way (verified here), and run their final `pkgbuild` /
  `dpkg-deb` step on macOS / Linux in CI. They are not run from the Windows dev
  box because those tools — and the matching native binaries — are platform
  specific.

## Local usage

```sh
# Windows (PowerShell), with the WiX tool installed:
node scripts/package/windows/build-msi.mjs

# macOS:
node scripts/package/macos/build-pkg.mjs

# Linux:
node scripts/package/linux/build-deb.mjs
```

Output lands in `dist-installers/`.
