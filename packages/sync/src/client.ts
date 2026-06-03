import type { Segment } from "@vtx-track/protocol";
import { open, seal, type SealedEnvelope } from "./crypto.js";
import { mergeSegments } from "./merge.js";

/** Configuration for a {@link SyncClient}. */
export interface SyncClientOptions {
  /** Base URL of your self-hosted sync server. */
  serverUrl: string;
  /** Shared bearer token for the server. */
  token: string;
  /** Passphrase used to encrypt/decrypt — never sent to the server. */
  passphrase: string;
  /** This machine's device id (e.g. hostname). */
  deviceId: string;
  /** Custom fetch (for tests). */
  fetch?: typeof fetch;
}

/**
 * Pushes this machine's segments to the sync server (encrypted) and pulls every
 * other device's segments, returning a merged timeline. The server only ever
 * holds ciphertext.
 */
export class SyncClient {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: SyncClientOptions) {
    this.base = opts.serverUrl.replace(/\/$/, "");
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
  }

  /** Encrypt and upload this device's segments. */
  async push(segments: Segment[]): Promise<void> {
    const envelope = seal(segments, this.opts.passphrase);
    const res = await this.fetchImpl(
      `${this.base}/device/${encodeURIComponent(this.opts.deviceId)}`,
      {
        method: "PUT",
        headers: this.headers(),
        body: JSON.stringify(envelope),
      },
    );
    if (!res.ok) throw new Error(`sync push failed: ${res.status}`);
  }

  /** List the device ids the server knows about. */
  async devices(): Promise<string[]> {
    const res = await this.fetchImpl(`${this.base}/devices`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`sync list failed: ${res.status}`);
    return ((await res.json()) as { devices: string[] }).devices;
  }

  /**
   * Pull and decrypt every device's segments (optionally excluding this one),
   * merged with the provided local segments into one timeline.
   */
  async pullMerged(localSegments: Segment[] = []): Promise<Segment[]> {
    const ids = await this.devices();
    const remote: Segment[][] = [localSegments];
    for (const id of ids) {
      if (id === this.opts.deviceId) continue;
      const env = await this.fetchEnvelope(id);
      if (env) remote.push(open<Segment[]>(env, this.opts.passphrase));
    }
    return mergeSegments(...remote);
  }

  private async fetchEnvelope(id: string): Promise<SealedEnvelope | null> {
    const res = await this.fetchImpl(
      `${this.base}/device/${encodeURIComponent(id)}`,
      { headers: this.headers() },
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`sync pull failed: ${res.status}`);
    return (await res.json()) as SealedEnvelope;
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.opts.token}`,
      "content-type": "application/json",
    };
  }
}
