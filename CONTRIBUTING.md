# Contributing to vtx-track

Thanks for wanting to help. vtx-track is a [VTX Labs](https://vtxlabs.dev)
open-source project. Issues and pull requests are welcome.

## Principles (please keep these intact)

vtx-track exists because time trackers usually want your data in their cloud.
Two rules are non-negotiable:

1. **Local-first.** No network calls in the hot path, no telemetry, no required
   cloud. The only egress is an export the user runs or a sync server the user
   hosts.
2. **Private by default.** Nothing new gets recorded without a clear opt-in.
   Window titles default to dropped; denylists and pause must keep working.

A change that breaks either of these won't be merged, however nice the feature.

## Getting set up

Requires **Node ≥ 20** and **pnpm**.

```bash
git clone https://github.com/VTX-Labs/vtx-track.git
cd vtx-track
pnpm install      # also fetches native prebuilds via scripts/fetch-native.mjs
pnpm build
pnpm test
```

If `pnpm install` can't fetch a native prebuilt binary for your platform it
falls back to compiling from source (needs a C/C++ toolchain). Re-run the
fetch any time with `node scripts/fetch-native.mjs`. See the root README's
Troubleshooting section.

## The monorepo

It's a pnpm workspace. Each package is independent and has its own README:

```
packages/protocol     shared wire types + typed client (zero deps)
packages/core         timeline engine: store, sessionizer, categorize, privacy, reports
packages/platform     native active-window + idle, behind one interface
packages/daemon       the background service
packages/service      OS service install/uninstall
packages/cli          the vtx-track CLI
packages/vscode       VS Code extension
packages/dashboard    localhost dashboard
packages/integrations export adapters
packages/sync         optional self-hosted encrypted sync
apps/browser-extension  MV3 tab-domain extension
```

Run a single package's checks with `pnpm --filter @vtx-track/<name> test` etc.

## Standards

- **TypeScript strict**, ESM, named exports only (no default exports for
  libraries). Match the surrounding code's style.
- **Minimal dependencies.** Every new runtime dep must earn its place; call it
  out in the PR.
- **Real tests.** Add vitest tests for new behavior. Never hit a live API or the
  network in a test — inject fakes (see existing tests for the pattern).
- Before opening a PR: `pnpm typecheck && pnpm test && pnpm build` all green, and
  the committed `pnpm-lock.yaml` is current.

## Pull requests

Open a PR against `main`. Fill in the template. Keep PRs focused. If you're
changing behavior, update the relevant README and (if architectural) DESIGN.md.

## Reporting bugs & security

- Functional bugs: open a [bug report](https://github.com/VTX-Labs/vtx-track/issues/new/choose).
  Never paste real private data (titles, paths) — redact.
- Security / privacy vulnerabilities: see [SECURITY.md](SECURITY.md) — report
  privately, don't open a public issue.

---

Built by [VTX Labs](https://vtxlabs.dev) · [GitHub](https://github.com/VTX-Labs/vtx-track) · [@vtxlabs](https://x.com/vtxlabs)
