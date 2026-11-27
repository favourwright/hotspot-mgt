/**
 * Every email renders, says only what its call site supplies, and cannot be
 * turned into markup by a value.
 *
 * What this replaced: `scripts/build-email-templates.mts` ran the variable
 * check once, when someone generated the HTML to paste into Mailtrap. Now the
 * HTML is drawn at send time, so the check runs in CI on every change.
 *
 * Run: npm run test:email-content
 */
import { EMAIL_CATALOG, type EmailKey } from "../lib/email-catalog";
import {
  ALWAYS_VARIABLES,
  hasEmailContent,
  placeholdersIn,
  renderEmail,
} from "../lib/email-content";
import { readSwitch } from "../lib/email-switches";

let failures = 0;
const fail = (message: string) => {
  console.log(`FAIL  ${message}`);
  failures++;
};

const DASHES = ["—", "–", "&mdash;", "&ndash;", "&#8212;", "&#8211;"];

for (const entry of EMAIL_CATALOG) {
  const key = entry.key as EmailKey;

  if (!hasEmailContent(key)) {
    fail(`${key}: no content in lib/email-content.ts`);
    continue;
  }

  // A placeholder the call site never supplies renders blank in a real
  // email - a customer with an empty space where their password should be.
  const used = new Set(placeholdersIn(key));
  const allowed = new Set<string>([...entry.variables, ...ALWAYS_VARIABLES]);
  const undeclared = [...used].filter((v) => !allowed.has(v));
  if (undeclared.length) fail(`${key}: uses undeclared ${undeclared.join(", ")}`);
  // The recipient's own address is passed for completeness and rarely shown.
  const unused = entry.variables.filter(
    (v) => !used.has(v) && v !== "owner_email" && v !== "customer_email"
  );
  if (unused.length) console.log(`note  ${key}: declares but never shows ${unused.join(", ")}`);

  const variables: Record<string, string> = {};
  for (const name of allowed) variables[name] = `v-${name}`;
  const rendered = renderEmail(key, variables);
  if (!rendered) {
    fail(`${key}: rendered null`);
    continue;
  }
  if (rendered.missing.length) fail(`${key}: missing ${rendered.missing.join(", ")}`);

  for (const [part, body] of Object.entries({
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  })) {
    if (body.includes("{{")) fail(`${key}: unfilled placeholder in ${part}`);
    // House style, checked on the output: an entity looks like markup in the
    // source and renders as a dash in the inbox, which is how one shipped.
    if (DASHES.some((d) => body.includes(d))) fail(`${key}: dash in ${part}`);
  }
  // Subject and text are plain text, so no entity may survive into them.
  if (/&[a-z]+;/.test(rendered.subject)) fail(`${key}: entity in subject: ${rendered.subject}`);
  if (/&[a-z]+;/.test(rendered.text)) fail(`${key}: entity in text part`);
  if (/<[a-z]/i.test(rendered.text)) fail(`${key}: markup in text part`);
}

// Escaping: Mailtrap's Handlebars did this for us, and now we do.
{
  const hostile = '<img src=x onerror="alert(1)"> & Co';
  const rendered = renderEmail("customer.voucher_ready", {
    business_name: hostile,
    voucher_username: "u",
    voucher_password: "p",
  });
  if (!rendered) fail("escape: rendered null");
  else {
    if (rendered.html.includes("<img src=x")) fail("escape: raw markup reached the html");
    if (!rendered.html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; Co"))
      fail("escape: escaped value not found in html");
    if (!rendered.subject.includes(hostile)) fail("escape: subject should carry the value as plain text");
    if (!rendered.text.includes(hostile)) fail("escape: text part should carry the value as plain text");
  }
}

// A value is never decoded: "&amp;" typed by a tenant stays "&amp;".
{
  const rendered = renderEmail("owner.account_reactivated", { business_name: "A &amp; B" });
  if (!rendered?.subject.startsWith("A &amp; B")) fail(`decode: subject was ${rendered?.subject}`);
}

// Missing values render blank and are reported, rather than leaving braces.
{
  const rendered = renderEmail("owner.account_reactivated", {});
  if (!rendered?.missing.includes("business_name")) fail("missing: business_name not reported");
  if (rendered?.html.includes("{{")) fail("missing: braces left in html");
}

// The switch reading rules in lib/email-switches.ts.
const switchCases: Array<[string, unknown, boolean]> = [
  ["no entry", undefined, false],
  ["old entry, enabled with template", { templateId: "abc", enabled: true }, true],
  ["old entry, template, enabled absent", { templateId: "abc" }, true],
  ["old entry, enabled, no template", { templateId: "", enabled: true }, false],
  ["old entry, template, switched off", { templateId: "abc", enabled: false }, false],
  ["new entry, on", { enabled: true }, true],
  ["new entry, off", { enabled: false }, false],
];
for (const [label, stored, expected] of switchCases) {
  const actual = readSwitch(stored).enabled;
  if (actual !== expected) fail(`switch: ${label}: expected ${expected}, got ${actual}`);
}

console.log(
  failures === 0
    ? `ok  ${EMAIL_CATALOG.length} emails, escaping, switch rules`
    : `\n${failures} failure(s)`
);
process.exit(failures === 0 ? 0 : 1);
