/**
 * Hook signing secrets, encrypted at rest.
 *
 * Unlike an API key, a signing secret has to be recoverable: we sign every
 * request with it. So it is encrypted (AES-256-GCM, which also detects
 * tampering), never hashed, with a key that lives only in the environment
 * (`HOOK_SECRETS_KEY`, 32 random bytes as base64). A Firestore export alone
 * does not reveal any tenant's secret.
 *
 * `keyVersion` is stored beside each ciphertext so the key itself can be
 * rotated later: a second key would become version 2, and both would be
 * readable while secrets are re-encrypted. Only version 1 exists today.
 *
 * The plaintext is shown to the tenant once, when it is created or rotated,
 * and is never logged.
 */

import { randomBytes } from "node:crypto";

import { decodeSecretKey, open, seal } from "@/lib/secret-box";

const KEY_VERSION = 1;

export class HookSecretsUnavailableError extends Error {
  constructor() {
    super("HOOK_SECRETS_KEY is not set, or is not 32 bytes of base64");
    this.name = "HookSecretsUnavailableError";
  }
}

function key(version: number): Buffer {
  const decoded = version === KEY_VERSION ? decodeSecretKey(process.env.HOOK_SECRETS_KEY) : null;
  if (!decoded) throw new HookSecretsUnavailableError();
  return decoded;
}

/** Whether hooks can be created on this server at all. */
export function hookSecretsConfigured(): boolean {
  try {
    key(KEY_VERSION);
    return true;
  } catch {
    return false;
  }
}

/** A new secret, in the form tenants paste into their server's config. */
export function generateHookSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

export function encryptHookSecret(plaintext: string): {
  ciphertext: string;
  keyVersion: number;
} {
  return { ciphertext: seal(plaintext, key(KEY_VERSION)), keyVersion: KEY_VERSION };
}

export function decryptHookSecret(ciphertext: string, keyVersion: number): string {
  return open(ciphertext, key(keyVersion));
}
