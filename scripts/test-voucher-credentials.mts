/**
 * The rules behind a customer-chosen wifi login.
 *
 * Worth a test rather than a careful read, because every case here is one
 * where the wrong answer is silent. A password equal to the username is a
 * working hotspot login for anyone who can read a username off a screen; a
 * trailing space is accepted by RouterOS, stored, emailed, and then
 * rejected by the login form with nothing to say why; a handle that reaches
 * the router with a slash in it addresses a different REST path.
 *
 * Run: npm run test:voucher-credentials
 */
import {
  generateHandleSuffix,
  normaliseHandle,
  routerUsernameFor,
  validateHandle,
  validateVoucherPassword,
} from "../lib/voucher-credentials";

let failed = 0;
let total = 0;

function check(name: string, got: boolean, want: boolean) {
  total += 1;
  const ok = got === want;
  if (!ok) failed += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name.padEnd(52)} ${got ? "accepted" : "rejected"}`
  );
}

console.log("Handles\n");

const handles: Array<[string, string, boolean]> = [
  ["ordinary", "favour", true],
  ["with digits", "favour92", true],
  ["dots and hyphens inside", "fa.vour-92", true],
  ["underscore inside", "fa_vour", true],
  ["uppercase is normalised, not refused", "Favour", true],
  ["surrounding whitespace is trimmed", "  favour  ", true],
  ["shortest allowed", "abc", true],
  ["too short", "ab", false],
  ["too long", "a".repeat(21), false],
  ["leading dot", ".favour", false],
  ["trailing hyphen", "favour-", false],
  ["a space inside", "fav our", false],
  // The charset exists because these end up in a RouterOS username and in
  // a REST path. A slash is the one that stops being a formatting problem.
  ["a slash", "fav/our", false],
  ["a quote", "fav'our", false],
  ["reserved: admin", "admin", false],
  ["reserved: default-trial", "default-trial", false],
  ["empty", "", false],
];

for (const [name, input, want] of handles) {
  check(name, validateHandle(input).ok, want);
}

console.log("\nPasswords\n");

const passwords: Array<[string, string, { handle?: string; email?: string }, boolean]> = [
  ["six characters is enough", "ab9x7q", { handle: "favour" }, true],
  ["five is not", "ab9x7", { handle: "favour" }, false],
  ["allowed punctuation", "ab9x7q.-_@", { handle: "favour" }, true],
  ["too long", "a9".repeat(17), { handle: "favour" }, false],
  ["a space inside", "ab 9x7q", { handle: "favour" }, false],
  ["a trailing space", "ab9x7q ", { handle: "favour" }, false],
  ["a leading space", " ab9x7q", { handle: "favour" }, false],
  // The whole reason this function takes a handle.
  ["equal to the handle", "favour", { handle: "favour" }, false],
  ["equal but for case", "FAVOUR", { handle: "favour" }, false],
  ["the handle with a digit on the end", "favour1", { handle: "favour" }, false],
  ["contained in the handle", "favo", { handle: "favour" }, false],
  ["a common password", "password", { handle: "favour" }, false],
  ["a common password, capitalised", "Password", { handle: "favour" }, false],
  [
    "the email local part",
    "favour.a",
    { handle: "zenith", email: "favour.a@example.com" },
    false,
  ],
  [
    "merely resembling the email",
    "favour.b",
    { handle: "zenith", email: "favour.a@example.com" },
    true,
  ],
  ["no handle known yet", "ab9x7q", {}, true],
];

for (const [name, input, context, want] of passwords) {
  check(name, validateVoucherPassword(input, context).ok, want);
}

console.log("\nRouter username\n");

total += 1;
const suffix = generateHandleSuffix();
const username = routerUsernameFor("  Favour ", suffix);
const shaped = username === `favour-${suffix}` && /^[a-z0-9]{4}$/.test(suffix);
if (!shaped) failed += 1;
console.log(
  `${shaped ? "PASS" : "FAIL"}  ${"handle is normalised into the username".padEnd(52)} ${username}`
);

// The suffix is what removes the need for an availability check, so it has
// to actually vary. Not a strength claim - just proof it is not constant.
total += 1;
const suffixes = new Set(
  Array.from({ length: 200 }, () => generateHandleSuffix())
);
const varies = suffixes.size > 150;
if (!varies) failed += 1;
console.log(
  `${varies ? "PASS" : "FAIL"}  ${"suffixes vary across 200 draws".padEnd(52)} ${suffixes.size} distinct`
);

total += 1;
const normalised = normaliseHandle(" FaVouR ") === "favour";
if (!normalised) failed += 1;
console.log(
  `${normalised ? "PASS" : "FAIL"}  ${"normaliseHandle trims and lowercases".padEnd(52)}`
);

if (failed > 0) {
  console.error(`\n${failed} of ${total} failed.`);
  process.exit(1);
}
console.log(`\nAll ${total} cases passed.`);
