/**
 * The one place a router's login is read from or written to a document.
 *
 * Passwords are encrypted at rest under `ROUTER_SECRETS_KEY`, so a Firestore export
 * or a leaked read does not hand over every tenant's router. They cannot be hashed:
 * we log in to the router with them.
 *
 * The rollout has three states, and all of them work:
 *   1. No key: new passwords are stored in plaintext, exactly as before.
 *   2. Key set: new passwords are encrypted, old ones still read as plaintext.
 *   3. After `npm run routers:encrypt -- --apply`: no plaintext left.
 *
 * Losing the key is an outage: every encrypted router stops working until its owner
 * types the password again. Dev and production share one Firebase project, so both
 * env files must hold the SAME key. See docs/auth-and-security.md.
 *
 * Never put these fields in a response or a client prop. RouterSchema leaves them
 * out on purpose, and scripts/test-router-credentials.mts fails on a direct read of
 * `.routerPass` anywhere else.
 */

import { FieldValue } from "firebase-admin/firestore";

import { decodeSecretKey, open, seal } from "@/lib/secret-box";

const KEY_VERSION = 1;

/**
 * An encrypted password could not be opened. Means a missing or wrong key rather
 * than a bad router, so callers must not report the router as offline.
 */
export class RouterSecretsUnavailableError extends Error {
  constructor() {
    super("Router password could not be decrypted: check ROUTER_SECRETS_KEY");
    this.name = "RouterSecretsUnavailableError";
  }
}

function currentKey(): Buffer | null {
  return decodeSecretKey(process.env.ROUTER_SECRETS_KEY);
}

export function routerSecretsConfigured(): boolean {
  return currentKey() !== null;
}

/** The credentials half of a RouterConfig, from a stored router document. */
export function routerLogin(data: Record<string, unknown>): {
  username: string;
  password: string;
} {
  return { username: String(data.routerUser ?? ""), password: readPassword(data) };
}

function readPassword(data: Record<string, unknown>): string {
  const ciphertext = data.routerPassCiphertext;
  if (typeof ciphertext !== "string") return String(data.routerPass ?? "");

  const key = data.routerPassKeyVersion === KEY_VERSION ? currentKey() : null;
  if (!key) throw new RouterSecretsUnavailableError();
  try {
    return open(ciphertext, key);
  } catch {
    throw new RouterSecretsUnavailableError();
  }
}

/** Fields that store a password on a new router. */
export function routerPasswordFields(plaintext: string): Record<string, unknown> {
  const key = currentKey();
  if (!key) return { routerPass: plaintext };
  return { routerPassCiphertext: seal(plaintext, key), routerPassKeyVersion: KEY_VERSION };
}

/**
 * Fields that replace the password on an existing router, removing whichever form
 * it is not stored in. `set` rejects these deletes, so they are kept apart from
 * routerPasswordFields.
 */
export function routerPasswordUpdateFields(plaintext: string): Record<string, unknown> {
  return currentKey()
    ? { ...routerPasswordFields(plaintext), routerPass: FieldValue.delete() }
    : {
        routerPass: plaintext,
        routerPassCiphertext: FieldValue.delete(),
        routerPassKeyVersion: FieldValue.delete(),
      };
}
