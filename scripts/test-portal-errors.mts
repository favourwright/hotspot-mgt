/**
 * The router-error mapping the captive portal shows customers.
 *
 * Two code paths have to agree here and are easy to drift apart: the tokens
 * our generated errors.txt emits, and the table that maps them back. A key
 * added to one and not the other produces a page that says "Sign-in didn't
 * work" for a cause we had specific advice for - a silent downgrade, with
 * nothing failing.
 *
 * The stock-wording fallback is the other half. It is ordered regex matching
 * against English prose, where a pattern placed too early swallows a more
 * specific one below it, and the cost of a wrong match is telling someone to
 * buy a plan they do not need.
 *
 * Run: npm run test:portal-errors
 */
const {
  friendlyPortalError,
  buildErrorsFile,
} = await import("../lib/hotspot-errors");

let failed = 0;

function check(label: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  ${detail}`}`);
}

// ---------------------------------------------------- errors.txt round trip

const file = buildErrorsFile();
const pairs = file
  .split("\n")
  .filter((line) => line.includes(" = ") && !line.startsWith("#"))
  .map((line) => line.split(" = ").map((p) => p.trim()) as [string, string]);

check("errors.txt defines at least a dozen keys", pairs.length >= 12, `got ${pairs.length}`);

for (const [key, token] of pairs) {
  const mapped = friendlyPortalError(token);
  // UNKNOWN is what an unrecognised value produces, so a token resolving to
  // it means the file and the table have drifted.
  check(
    `token for "${key}" maps to specific copy`,
    mapped !== null && mapped.title !== "Sign-in didn't work",
    `got ${JSON.stringify(mapped?.title)}`
  );
  check(
    `token for "${key}" is URL-safe`,
    /^[a-z-]+$/.test(token),
    `token was "${token}"`
  );
}

// ------------------------------------------------------------- stock wording

const stock: Array<[string, string]> = [
  ["invalid username or password", "That voucher didn't work"],
  ["no more sessions are allowed for user HS-4KJ2P9XQ", "That voucher is already in use"],
  ["session limit reached (10)", "The network is full right now"],
  ["cannot assign ip address - no more free addresses from pool", "The network is full right now"],
  ["hotspot service is shutting down", "The Wi-Fi is restarting"],
  ["you are not logged in", "You are not signed in"],
  ["uptime limit reached", "Your plan has run out of time"],
  ["transfer limit reached", "You have used all your data"],
  ["RADIUS server is not responding", "We could not check your voucher"],
  ["internal error (unexpected)", "Something went wrong on the network"],
];

for (const [raw, expectedTitle] of stock) {
  const mapped = friendlyPortalError(raw);
  check(
    `stock: "${raw.slice(0, 44)}"`,
    mapped?.title === expectedTitle,
    `wanted ${JSON.stringify(expectedTitle)}, got ${JSON.stringify(mapped?.title)}`
  );
}

// --------------------------------------------------------------- edge cases

check("no error renders nothing", friendlyPortalError(null) === null);
check("empty string renders nothing", friendlyPortalError("") === null);
check("whitespace renders nothing", friendlyPortalError("   ") === null);
check(
  "an unsubstituted placeholder is not an error",
  friendlyPortalError("$(error)") === null
);
check(
  "an unknown message never shows the customer router jargon",
  friendlyPortalError("invalid chap-id 0x4f")?.body.includes("chap-id") === false
);
check(
  "an unknown token falls back rather than throwing",
  friendlyPortalError("oga-does-not-exist")?.title === "Sign-in didn't work"
);
check(
  "matching is case-insensitive",
  friendlyPortalError("Invalid Username Or Password")?.title ===
    "That voucher didn't work"
);
check(
  "a full network does not try to sell a plan",
  friendlyPortalError("oga-license-session-limit")?.offerPlans === false
);
check(
  "an expired plan does",
  friendlyPortalError("oga-uptime-limit")?.offerPlans === true
);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll checks passed.");
