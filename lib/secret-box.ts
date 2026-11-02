/**
 * AES-256-GCM for secrets we have to be able to read back, which is why they are
 * encrypted rather than hashed. GCM also detects tampering: a changed ciphertext
 * fails to open instead of decrypting to garbage.
 *
 * Each kind of secret has its own key and its own module (lib/hook-secrets.ts,
 * lib/router-credentials.ts), so losing or rotating one touches nothing else.
 * Stored form: base64 iv, auth tag and body joined by dots.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** A key from the environment: 32 bytes as base64. Null if absent or malformed. */
export function decodeSecretKey(raw: string | undefined): Buffer | null {
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  return key.length === 32 ? key : null;
}

export function seal(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, body].map((part) => part.toString("base64")).join(".");
}

/** Throws on a malformed value, the wrong key, or any tampering. */
export function open(ciphertext: string, key: Buffer): string {
  const [iv, tag, body] = ciphertext.split(".").map((part) => Buffer.from(part, "base64"));
  if (!iv || !tag || !body) throw new Error("Malformed ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}
