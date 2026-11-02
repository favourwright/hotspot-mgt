/**
 * Fails the build if server knowledge reaches the browser.
 *
 * Runs on `postbuild`, against what is actually about to ship. Everything under
 * .next/static is public to anyone with no login, so this is the control that
 * protects the product's logic: minified code can be read, and obfuscation would
 * not change that. What matters is that the valuable parts are never there.
 *
 * It prevents the mistakes that do not look like mistakes: a shared helper gains
 * an import, and fulfilment logic is suddenly in a client chunk with nothing
 * failing. Values are never printed, only names and file paths.
 *
 * If this fails, do not add an exception first. Find what imported it.
 *
 * Run: npm run check:client-bundle (after a build)
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = ".next/static";

/** [what it means, the text that gives it away]. */
const FORBIDDEN: Array<[string, string]> = [
  // The browser has no database access. See firestore.rules.
  ["the Firestore client SDK", "firestore.googleapis.com"],
  ["the Admin SDK", "firebase-admin"],
  ["custom token minting", "createCustomToken"],
  // Router and portal internals: generated on the server, sent to routers.
  ["RouterOS hotspot calls", "/ip/hotspot"],
  ["portal page generation", "alogin.html"],
  ["the portal's router directory", "hotspot-oga"],
  ["the WireGuard manager", "X-WG-Secret"],
  // Private key material of any kind.
  ["a private key", "BEGIN PRIVATE KEY"],
  ["a live Paystack secret key", "sk_live_"],
  ["a test Paystack secret key", "sk_test_"],
];

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

/**
 * The real values of every credential in the local env files, when they exist
 * (they do not in CI, where the patterns above still run). Values and not names:
 * the superadmin UI legitimately tells an operator which variable to set, while
 * a value in a chunk is a leak whatever it is called. Never printed.
 */
const CREDENTIAL = /KEY|SECRET|TOKEN|PASSWORD|PASS$|CLIENT_EMAIL|SUPERADMIN_EMAIL|^ADMIN_EMAIL/;

function credentialValues(): Array<[string, string]> {
  return [".env.production", ".env.development.local"].flatMap((file) => {
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8").split("\n").flatMap((line): Array<[string, string]> => {
      const match = /^([A-Z][A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!match || match[1].startsWith("NEXT_PUBLIC_") || !CREDENTIAL.test(match[1])) return [];
      const value = match[2].trim().replace(/^["']|["']$/g, "");
      return value.length >= 6 ? [[`the value of ${match[1]}`, value]] : [];
    });
  });
}

if (!existsSync(ROOT)) {
  console.error(`${ROOT} does not exist. Build first.`);
  process.exit(1);
}

const files = filesUnder(ROOT);
const problems: string[] = [];

for (const file of files) {
  // Source maps in a public directory hand over the original source.
  if (file.endsWith(".map")) problems.push(`source map is public: ${file}`);
}

const scanned = files.filter((file) => /\.(js|css|json|html|txt)$/.test(file));
const needles: Array<[string, string]> = [
  ...FORBIDDEN,
  ...credentialValues(),
];

for (const file of scanned) {
  const content = readFileSync(file, "utf8");
  for (const [meaning, needle] of needles) {
    if (content.includes(needle)) problems.push(`${meaning} found in ${file}`);
  }
}

if (problems.length > 0) {
  console.error("Client bundle check FAILED:\n");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error("\nThese files are public. Find what imported this into client code.");
  process.exit(1);
}

console.log(`Client bundle clean: ${scanned.length} files, ${needles.length} checks, no source maps.`);
