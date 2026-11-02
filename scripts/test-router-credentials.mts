/**
 * Router passwords at rest (lib/router-credentials.ts).
 *
 * The rollout states all have to work, because the code ships before the key does.
 * The source scan and the schema check keep the fix in place: a direct `.routerPass`
 * read would skip decryption, and a credential on the read model reaches the browser
 * as a page prop, which is how plaintext passwords used to reach it.
 *
 * Run: npm run test:router-credentials
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

process.env.FIREBASE_PROJECT_ID ??= "test";
process.env.FIREBASE_CLIENT_EMAIL ??= "test@test.invalid";
process.env.FIREBASE_PRIVATE_KEY ??= "test";

const {
  RouterSecretsUnavailableError,
  routerLogin,
  routerPasswordFields,
  routerPasswordUpdateFields,
  routerSecretsConfigured,
} = await import("../lib/router-credentials");
const { RouterSchema } = await import("../types/schemas");

const PASSWORD = "tenant-router-p@ss/word";
const KEY = randomBytes(32).toString("base64");
const isDelete = (value: unknown) => value?.constructor?.name === "DeleteTransform";

// No key: nothing changes.
delete process.env.ROUTER_SECRETS_KEY;
assert.equal(routerSecretsConfigured(), false);
assert.deepEqual(routerPasswordFields(PASSWORD), { routerPass: PASSWORD });
assert.deepEqual(routerLogin({ routerUser: "admin", routerPass: PASSWORD }), {
  username: "admin",
  password: PASSWORD,
});
const plainUpdate = routerPasswordUpdateFields(PASSWORD);
assert.equal(plainUpdate.routerPass, PASSWORD);
assert.ok(isDelete(plainUpdate.routerPassCiphertext), "a stale ciphertext would win over the new password");

// A malformed key counts as no key, never as a weak key.
process.env.ROUTER_SECRETS_KEY = "too-short";
assert.equal(routerSecretsConfigured(), false);
assert.deepEqual(routerPasswordFields(PASSWORD), { routerPass: PASSWORD });

// Key set: writes are encrypted, old plaintext still reads.
process.env.ROUTER_SECRETS_KEY = KEY;
assert.equal(routerSecretsConfigured(), true);
const stored = routerPasswordFields(PASSWORD);
assert.equal(stored.routerPass, undefined);
assert.ok(!JSON.stringify(stored).includes(PASSWORD));
assert.equal(routerLogin({ routerUser: "a", ...stored }).password, PASSWORD);
assert.equal(routerLogin({ routerUser: "a", routerPass: PASSWORD }).password, PASSWORD);
assert.notEqual(routerPasswordFields(PASSWORD).routerPassCiphertext, stored.routerPassCiphertext);
assert.ok(isDelete(routerPasswordUpdateFields(PASSWORD).routerPass), "plaintext must go on update");

// Ciphertext wins if both exist, as in a crash mid-rollout.
assert.equal(routerLogin({ ...stored, routerPass: "stale" }).password, PASSWORD);

// Every failure names the key and never the secret, and never falls back to plaintext.
const refuses = (data: Record<string, unknown>) =>
  assert.throws(
    () => routerLogin(data),
    (error: Error) =>
      error instanceof RouterSecretsUnavailableError && !error.message.includes(PASSWORD)
  );
const text = stored.routerPassCiphertext as string;
const [iv, tag, body] = text.split(".");
const flipped = Buffer.from(body, "base64");
flipped[0] ^= 1;
refuses({ ...stored, routerPassCiphertext: [iv, tag, flipped.toString("base64")].join(".") });
refuses({ ...stored, routerPassCiphertext: "not-ciphertext" });
refuses({ ...stored, routerPassKeyVersion: 2 });
refuses({ ...stored, routerPass: "stale", routerPassKeyVersion: 2 });
process.env.ROUTER_SECRETS_KEY = randomBytes(32).toString("base64");
refuses(stored);
delete process.env.ROUTER_SECRETS_KEY;
refuses(stored);

// The read model that pages pass to client components has no credentials.
const parsed = RouterSchema.parse({
  id: "r1",
  name: "Main",
  connectionMethod: "direct",
  routerIp: "203.0.113.10",
  routerUser: "admin",
  routerPass: PASSWORD,
  ...stored,
  status: "online",
  createdAt: new Date(),
  updatedAt: new Date(),
});
for (const field of ["routerUser", "routerPass", "routerPassCiphertext", "routerPassKeyVersion"]) {
  assert.ok(!(field in parsed), `${field} would reach the browser as a page prop`);
}

// Nothing reads the field directly.
const direct = /\b\w+(\?)?\.routerPass\b/;
const offenders: string[] = [];
for (const root of ["app", "lib", "components", "hooks", "services", "providers"]) {
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
    const path = join(entry.parentPath, entry.name);
    if (path === join("lib", "router-credentials.ts")) continue;
    if (direct.test(readFileSync(path, "utf8"))) offenders.push(path);
  }
}
assert.deepEqual(offenders, [], "read router passwords through routerLogin()");

console.log("router credentials ok");
