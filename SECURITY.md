# Security Policy

vtx-track observes everything you do on your machine, so we take its security
and privacy posture seriously.

## Reporting a vulnerability

**Please do not open a public issue for security or privacy vulnerabilities.**

Report privately via GitHub's
[security advisories](https://github.com/VTX-Labs/vtx-track/security/advisories/new),
or email **contact@vtxlabs.dev**. We'll acknowledge within a few days and keep
you updated on the fix.

Things we especially want to hear about:

- Any way the daemon's local servers could be reached or abused by another
  process or off-machine (they must bind to `127.0.0.1` only; the control
  endpoints are token-gated).
- Any path where tracked data (window titles, file paths, domains) could leak
  off the machine without an explicit user action.
- Weaknesses in the `@vtx-track/sync` end-to-end encryption (AES-256-GCM with a
  scrypt-derived key) that could let a sync server read user data.
- Privilege-escalation in the service installers.

## Supported versions

vtx-track is pre-1.0; security fixes land on `main`. Pin a commit if you need
stability and watch the repo for advisories.

## Scope notes

- The daemon stores data unencrypted at rest in `~/.vtx-track/` — that file is
  protected by your OS user account, the same as any local app data. Full-disk
  encryption is recommended for sensitive machines.
- The local control token lives at `~/.vtx-track/token` (`0600`). Treat it like
  any local credential.
