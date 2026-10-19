/**
 * The tenant support number, normalised.
 *
 * Owners type a Nigerian mobile four different ways and the stored value
 * has to be one shape, because three consumers assume it: the `tel:` link,
 * the WhatsApp deep link and the settings form's `+234` addon, which shows
 * only the local part. A number that normalises wrong is published on the
 * captive portal, where the people who find out are customers who cannot
 * reach the venue.
 *
 * Run: npm run test:phone
 */
const {
  normalizeNigerianPhone,
  formatLocalPhone,
  whatsappDigits,
  whatsappHref,
  telHref,
} = await import("../lib/phone");

let failed = 0;

function check(label: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  ${detail}`}`);
}

// ------------------------------------------------- the four ways people type

const SAME = "+2348031234567";

for (const input of [
  "08031234567",
  "8031234567",
  "2348031234567",
  "+2348031234567",
  "+234 803 123 4567",
  "0803 123 4567",
  "0803-123-4567",
  "(0803) 123 4567",
  "  08031234567  ",
]) {
  const got = normalizeNigerianPhone(input);
  check(`"${input}" normalises`, got === SAME, `got ${got}`);
}

// All three mobile prefixes in use.
for (const nsn of ["7011234567", "8031234567", "9011234567"]) {
  check(
    `${nsn.slice(0, 3)} prefix accepted`,
    normalizeNigerianPhone(nsn) === `+234${nsn}`
  );
}

// ----------------------------------------------------------------- rejected

for (const input of [
  "", // empty
  "0803123456", // nine digits after the trunk zero
  "080312345678", // eleven
  "06031234567", // not a mobile prefix
  "0803123456a", // a letter
  "+1 415 555 0100", // not Nigerian
  "02341234567", // a trunk zero in front of the country code
]) {
  const got = normalizeNigerianPhone(input);
  check(`"${input}" rejected`, got === null, `got ${got}`);
}

// ------------------------------------------------------------- what we emit

check(
  "local part is grouped for reading",
  formatLocalPhone(SAME) === "803 123 4567",
  formatLocalPhone(SAME)
);

check(
  "a value that is not a stored number is passed through untouched",
  formatLocalPhone("+15551234567") === "+15551234567"
);

check(
  "whatsapp digits carry the country code and no plus",
  whatsappDigits(SAME) === "2348031234567",
  whatsappDigits(SAME)
);

const href = whatsappHref(SAME, "Hi, I need help getting online at Cafe.");
check(
  "whatsapp link uses the app scheme, never wa.me",
  href.startsWith("whatsapp://send?") && !href.includes("wa.me"),
  href
);
check(
  "whatsapp link carries phone and text",
  href.includes("phone=2348031234567") && href.includes("text=Hi%2C"),
  href
);

check("tel link keeps the plus", telHref(SAME) === "tel:+2348031234567");

console.log(failed === 0 ? "\nAll passed." : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
