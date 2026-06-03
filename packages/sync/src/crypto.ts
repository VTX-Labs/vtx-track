import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";

/**
 * End-to-end encryption for synced data. The sync server only ever sees
 * ciphertext: the passphrase never leaves the client, and the derived key is
 * used locally to seal/open payloads. This keeps multi-machine sync as private
 * as the rest of vtx-track.
 */

const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;
const SALT_LEN = 16;

/** An encrypted envelope, safe to store on an untrusted server. */
export interface SealedEnvelope {
  /** Format version, for forward compatibility. */
  v: 1;
  /** Base64 scrypt salt. */
  salt: string;
  /** Base64 AES-GCM IV. */
  iv: string;
  /** Base64 GCM auth tag. */
  tag: string;
  /** Base64 ciphertext. */
  data: string;
}

/** Derive a 32-byte key from a passphrase + salt using scrypt. */
export function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, KEY_LEN);
}

/** Encrypt an arbitrary JSON-serializable value with a passphrase. */
export function seal(value: unknown, passphrase: string): SealedEnvelope {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = deriveKey(passphrase, salt);
  const cipher = createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: data.toString("base64"),
  };
}

/** Decrypt an envelope. Throws if the passphrase is wrong or data is tampered. */
export function open<T = unknown>(envelope: SealedEnvelope, passphrase: string): T {
  const salt = Buffer.from(envelope.salt, "base64");
  const iv = Buffer.from(envelope.iv, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  const key = deriveKey(passphrase, salt);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}
