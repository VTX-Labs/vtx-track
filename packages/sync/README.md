# @vtx-track/sync

**Optional, self-hosted, end-to-end-encrypted sync for [vtx-track](https://github.com/VTX-Labs/vtx-track).** Merge your timeline across machines — without a third-party cloud, and without the server ever seeing your data.

vtx-track is local-first by default; sync is entirely opt-in. This package lets you stand up your **own** tiny sync server and point your machines at it. Each machine encrypts its segments client-side and uploads only ciphertext; pulling decrypts everyone else's segments locally and merges them into one timeline. The server is deliberately dumb — it stores one opaque blob per device and hands it back. See [DESIGN.md](../../DESIGN.md) for where this fits.

It is part of the vtx-track workspace and not published to npm.

## How the encryption works (the server can't read your data)

The trust model is simple: **the passphrase never leaves the client.**

- A 32-byte key is derived from your passphrase with **scrypt** and a random 16-byte salt (`deriveKey`).
- Segments are encrypted with **AES-256-GCM** using a random 12-byte IV (`seal`), producing a `SealedEnvelope`:

  ```ts
  interface SealedEnvelope {
    v: 1;
    salt: string; // base64 scrypt salt
    iv: string;   // base64 AES-GCM IV
    tag: string;  // base64 GCM auth tag
    data: string; // base64 ciphertext
  }
  ```

- The envelope is what gets uploaded. The server stores it verbatim and can never decrypt it — it has no passphrase and no key.
- `open()` reverses this. Because it's GCM, a wrong passphrase **or** any tampering with the stored bytes makes decryption throw rather than return garbage.

The server's only secret is a shared **bearer token** you choose, used purely for access control (so randoms can't write to your store). That token is not the encryption key and gives the server no ability to read anything.

```ts
import { seal, open, deriveKey } from "@vtx-track/sync";

const envelope = seal(segments, passphrase); // encrypt locally
const segments = open(envelope, passphrase);  // decrypt locally
```

## Client usage

`SyncClient` pushes this machine's segments (encrypted) and pulls every other device's segments, returning a merged timeline.

```ts
import { SyncClient } from "@vtx-track/sync";

const client = new SyncClient({
  serverUrl: "https://sync.example.com",
  token: process.env.VTX_SYNC_TOKEN!, // server access token
  passphrase: "correct horse battery staple", // never sent to the server
  deviceId: "laptop", // e.g. hostname
});

await client.push(localSegments);                 // encrypt + upload this device
const ids = await client.devices();               // device ids the server knows
const merged = await client.pullMerged(localSegments); // decrypt others + merge
```

`pullMerged` skips this device's own envelope and merges the rest with your local segments via `mergeSegments`.

### Merge semantics

```ts
import { mergeSegments, keyOf, overlapMs } from "@vtx-track/sync";
```

- `mergeSegments(...sources)` keys each segment by `(host, startedAt, app)`, so re-syncing the same machine is idempotent and two machines interleave without duplication (last write wins on an identical key). Results are sorted by start time.
- `keyOf(segment)` exposes that stable identity.
- `overlapMs(a, b)` reports total wall-clock overlap between two machines' timelines — useful to warn that cross-machine totals may double-count if you really were on two machines at once.

## Run your own server

The package ships a `vtx-track-sync-server` bin (`dist/server-main.js`). It's a single Node HTTP server with no dependencies beyond the standard library, configured entirely via environment variables:

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `VTX_SYNC_TOKEN` | **yes** | — | Shared bearer token required on every request. Use a long random value. |
| `VTX_SYNC_PORT` | no | `7843` | Listen port. |
| `VTX_SYNC_STORE` | no | `~/.vtx-track/sync-store.json` | Path to the JSON store of sealed envelopes. |

```bash
# The installed bin:
VTX_SYNC_TOKEN="$(openssl rand -hex 32)" vtx-track-sync-server
# → vtx-track sync server listening on :7843

# From source, inside the monorepo:
VTX_SYNC_TOKEN=... pnpm --filter @vtx-track/sync dev
```

If `VTX_SYNC_TOKEN` is unset the server refuses to start. It handles `SIGINT`/`SIGTERM` for a clean shutdown. Put it behind HTTPS (a reverse proxy) for transport security — the payloads are already encrypted, but TLS protects the bearer token and metadata in transit.

### HTTP API

| Method & path | Auth | Behaviour |
| --- | --- | --- |
| `GET /health` | none | `{ ok: true, devices: <count> }` |
| `GET /devices` | bearer | List device ids that have data. |
| `GET /device/:id` | bearer | Return that device's sealed envelope (404 if none). |
| `PUT /device/:id` | bearer | Store a sealed envelope for a device (validated as an envelope). |

Every non-`/health` request must send `Authorization: Bearer <VTX_SYNC_TOKEN>` or it gets `401`.

```ts
import { createSyncServer } from "@vtx-track/sync";

const server = createSyncServer({ token, storePath });
server.listen(7843);
```

## Privacy

The server only ever holds ciphertext. Your passphrase — and therefore your ability to read your timeline — never leaves your machines. Lose the passphrase and the data is unrecoverable; that's the point. Sync is off unless you set it up.

---

Built by [VTX Labs](https://vtxlabs.dev) · [GitHub](https://github.com/VTX-Labs/vtx-track) · [@vtxlabs](https://x.com/vtxlabs)
