/**
 * Generates every Mailtrap template body into `email-templates/`.
 *
 * One shell, seventeen content definitions. The alternative - seventeen
 * hand-written HTML files - means a change to the header or the dark-mode
 * palette has to be made seventeen times and will drift the first time
 * someone misses one.
 *
 * Every colour here is a token from app/globals.css baked down to hex,
 * because no email client supports oklch(). Layout is tables with inline
 * styles for the same reason.
 *
 * Run: npx tsx scripts/build-email-templates.mts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { EMAIL_CATALOG } from "../lib/email-catalog";

const OUT = path.resolve(process.cwd(), "email-templates");

const C = {
  canvas: "#f3f4f6",
  raised: "#ffffff",
  panel: "#f1f3f3",
  fg: "#090b0c",
  muted: "#67787c",
  border: "#e3e7e8",
  primary: "#c6005c",
  primaryFg: "#fdf2f8",
  destructive: "#e7000b",
  darkBg: "#090b0c",
  darkCard: "#161b1d",
  darkFg: "#f9fbfb",
  darkMuted: "#9ca8ab",
  darkPrimary: "#a3004c",
  darkRule: "#2a3133",
};
const FONT =
  "'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

type Block =
  | { kind: "steps"; title: string; items: string[] }
  | { kind: "rows"; title: string; rows: [string, string][] }
  | { kind: "credentials"; title: string; username: string; password: string }
  | { kind: "callout"; tone: "normal" | "alert"; text: string };

interface Def {
  key: string;
  subject: string;
  preheader: string;
  heading: string;
  lead: string;
  blocks: Block[];
  button?: { label: string; url: string };
  note?: string;
}

const eyebrow = (text: string, color = C.fg) =>
  `<p class="fg" style="margin:0 0 16px 0;font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${color};">${text}</p>`;

function panel(inner: string) {
  return `
            <tr>
              <td class="sp-x" style="padding:28px 40px 0 40px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="panel" style="background-color:${C.panel};border-radius:20px;">
                  <tr><td style="padding:24px;font-family:${FONT};">${inner}</td></tr>
                </table>
              </td>
            </tr>`;
}

function renderBlock(b: Block): string {
  if (b.kind === "steps") {
    const items = b.items
      .map(
        (t, i) =>
          `<tr><td width="28" valign="top" style="font-size:15px;line-height:1.6;color:${C.primary};font-weight:700;">${i + 1}</td><td class="muted" style="font-size:15px;line-height:1.6;color:${C.muted};padding-bottom:${i === b.items.length - 1 ? 0 : 10}px;">${t}</td></tr>`
      )
      .join("");
    return panel(
      eyebrow(b.title) +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${items}</table>`
    );
  }

  if (b.kind === "rows") {
    const rows = b.rows
      .map(
        ([label, value], i) =>
          `<tr><td class="muted" style="font-size:14px;line-height:1.6;color:${C.muted};padding-bottom:${i === b.rows.length - 1 ? 0 : 10}px;white-space:nowrap;padding-right:16px;">${label}</td><td class="fg" align="right" style="font-size:14px;line-height:1.6;color:${C.fg};font-weight:600;padding-bottom:${i === b.rows.length - 1 ? 0 : 10}px;">${value}</td></tr>`
      )
      .join("");
    return panel(
      eyebrow(b.title) +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>`
    );
  }

  if (b.kind === "credentials") {
    // The one thing in this entire system a customer actually needs. Big,
    // monospace, and selectable: people read these off a screen and type
    // them into a router login on a phone keyboard.
    const field = (label: string, value: string) =>
      `<tr><td style="padding-bottom:4px;"><span class="muted" style="font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:${C.muted};font-family:${FONT};">${label}</span></td></tr>
       <tr><td style="padding-bottom:16px;"><span class="fg" style="font-size:24px;font-weight:700;letter-spacing:0.04em;color:${C.fg};font-family:'Geist Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">${value}</span></td></tr>`;
    return panel(
      eyebrow(b.title) +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${field("Username", b.username)}${field("Password", b.password)}</table>`
    );
  }

  const color = b.tone === "alert" ? C.destructive : C.muted;
  return panel(
    `<p class="muted" style="margin:0;font-size:15px;line-height:1.6;color:${color};font-family:${FONT};">${b.text}</p>`
  );
}

function render(d: Def): string {
  const button = d.button
    ? `
            <tr>
              <td class="sp-x" align="left" style="padding:28px 40px 0 40px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td class="btn" style="background-color:${C.primary};border-radius:10px;">
                      <a href="${d.button.url}" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:15px;font-weight:600;line-height:1;color:${C.primaryFg};text-decoration:none;">${d.button.label}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`
    : "";

  const note = d.note
    ? `
            <tr>
              <td class="sp-x" style="padding:32px 40px 0 40px;">
                <div class="rule" style="height:1px;line-height:1px;font-size:0;background-color:${C.border};">&nbsp;</div>
              </td>
            </tr>
            <tr>
              <td class="sp-x" style="padding:20px 40px 40px 40px;font-family:${FONT};">
                <p class="muted" style="margin:0;font-size:14px;line-height:1.6;color:${C.muted};">${d.note}</p>
              </td>
            </tr>`
    : `<tr><td style="padding-bottom:40px;">&nbsp;</td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${d.subject}</title>
<style>
  /* Honoured by Apple Mail and iOS Mail. Gmail ignores it, which is why the
     light palette has to look right on its own. */
  @media (prefers-color-scheme: dark) {
    .bg    { background-color:${C.darkBg} !important; }
    .card  { background-color:${C.darkCard} !important; }
    .panel { background-color:${C.darkBg} !important; }
    .fg    { color:${C.darkFg} !important; }
    .muted { color:${C.darkMuted} !important; }
    .btn   { background-color:${C.darkPrimary} !important; }
    .rule  { background-color:${C.darkRule} !important; }
  }
  @media only screen and (max-width:600px) {
    .sp-x { padding-left:24px !important; padding-right:24px !important; }
    .h1   { font-size:26px !important; }
  }
</style>
</head>
<body class="bg" style="margin:0;padding:0;background-color:${C.canvas};">

<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${d.preheader}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg" style="background-color:${C.canvas};">
<tr>
<td align="center" style="padding:40px 16px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">

    <tr>
      <td align="left" style="padding:0 8px 20px 8px;font-family:${FONT};">
        <span class="fg" style="font-size:17px;font-weight:700;letter-spacing:-0.02em;color:${C.fg};">Oga</span><span style="font-size:17px;font-weight:700;letter-spacing:-0.02em;color:${C.primary};">WiFi</span>
      </td>
    </tr>

    <tr>
      <td class="card" style="background-color:${C.raised};border-radius:24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">

          <tr>
            <td class="sp-x" style="padding:40px 40px 0 40px;font-family:${FONT};">
              <h1 class="h1 fg" style="margin:0 0 12px 0;font-size:30px;line-height:1.2;font-weight:700;letter-spacing:-0.03em;color:${C.fg};">${d.heading}</h1>
              <p class="muted" style="margin:0;font-size:16px;line-height:1.6;color:${C.muted};">${d.lead}</p>
            </td>
          </tr>
${d.blocks.map(renderBlock).join("")}${button}${note}
        </table>
      </td>
    </tr>

    <tr>
      <td align="center" style="padding:24px 8px 0 8px;font-family:${FONT};">
        <p class="muted" style="margin:0;font-size:13px;line-height:1.6;color:${C.muted};">
          &copy; {{year}} OgaWiFi &middot; <a href="{{app_url}}" class="muted" style="color:${C.muted};text-decoration:underline;">{{app_url}}</a>
        </p>
      </td>
    </tr>

  </table>
</td>
</tr>
</table>

</body>
</html>
`;
}

const SUPPORT = `<a href="mailto:{{support_email}}" style="color:${C.primary};text-decoration:none;font-weight:600;">{{support_email}}</a>`;
const EM = (v: string) =>
  `<span style="color:${C.primary};font-weight:600;">{{${v}}}</span>`;

const DEFS: Def[] = [
  {
    key: "customer.welcome",
    subject: "Your OgaWiFi account is ready",
    preheader: "Your account is ready. Buy a WiFi voucher at any OgaWiFi hotspot.",
    heading: "You&rsquo;re all set",
    lead: `Your account is ready. We created it for ${EM("customer_email")}.`,
    blocks: [
      {
        kind: "steps",
        title: "How it works",
        items: [
          "Connect to any OgaWiFi hotspot near you.",
          "Pick a plan and pay. It takes a few seconds.",
          "You&rsquo;re online. Your voucher details are emailed to you and saved to your account.",
        ],
      },
    ],
    button: { label: "Open OgaWiFi", url: "{{app_url}}" },
    note: `Didn&rsquo;t create this account? Let us know at ${SUPPORT} and we&rsquo;ll take care of it.`,
  },
  {
    key: "customer.voucher_ready",
    subject: "Your WiFi voucher from {{business_name}}",
    preheader: "Your voucher is ready. Keep this email, it has your login details.",
    heading: "You&rsquo;re connected",
    lead: `Your voucher from ${EM("business_name")} is ready. Keep this email: these details are how you get back online.`,
    blocks: [
      { kind: "credentials", title: "Your login", username: "{{voucher_username}}", password: "{{voucher_password}}" },
      {
        kind: "rows",
        title: "Details",
        rows: [
          ["Plan", "{{plan_name}}"],
          ["Location", "{{location_name}}"],
          ["Duration", "{{duration}}"],
          ["Data", "{{data_limit}}"],
          ["Paid", "{{amount}}"],
          ["Reference", "{{reference}}"],
        ],
      },
    ],
    button: { label: "View my vouchers", url: "{{portal_url}}" },
    note: `Trouble getting online? Reply to this email or contact ${SUPPORT}.`,
  },
  {
    key: "customer.voucher_pending",
    subject: "We&rsquo;re setting up your WiFi access",
    preheader: "Your payment went through. We are finishing your connection now.",
    heading: "Almost there",
    lead: `Your payment to ${EM("business_name")} went through. Setting up your access hit a snag on their end, and they have been notified.`,
    blocks: [
      {
        kind: "callout",
        tone: "normal",
        text: "You don&rsquo;t need to pay again or do anything else. You&rsquo;ll get another email with your login details as soon as it&rsquo;s sorted.",
      },
      {
        kind: "rows",
        title: "Your payment",
        rows: [
          ["Plan", "{{plan_name}}"],
          ["Location", "{{location_name}}"],
          ["Paid", "{{amount}}"],
          ["Reference", "{{reference}}"],
        ],
      },
    ],
    note: `Been waiting a while? Contact ${SUPPORT} with the reference above.`,
  },
  {
    key: "customer.voucher_activated",
    subject: "Your WiFi voucher is ready",
    preheader: "Sorted. Here are the login details for your voucher.",
    heading: "You&rsquo;re good to go",
    lead: `Sorted. Your access at ${EM("business_name")} is active and these are your login details.`,
    blocks: [
      { kind: "credentials", title: "Your login", username: "{{voucher_username}}", password: "{{voucher_password}}" },
      {
        kind: "rows",
        title: "Details",
        rows: [
          ["Plan", "{{plan_name}}"],
          ["Location", "{{location_name}}"],
          ["Duration", "{{duration}}"],
          ["Data", "{{data_limit}}"],
        ],
      },
    ],
    button: { label: "View my vouchers", url: "{{portal_url}}" },
    note: `Thanks for your patience. Anything else, we&rsquo;re at ${SUPPORT}.`,
  },
  {
    key: "customer.voucher_expiring",
    subject: "Your WiFi access is about to run out",
    preheader: "Your plan expires soon. Top up to stay online.",
    heading: "Running out soon",
    lead: `Your ${EM("plan_name")} at ${EM("business_name")} is close to expiring.`,
    blocks: [{ kind: "rows", title: "Expires", rows: [["Plan", "{{plan_name}}"], ["Expires", "{{expires_at}}"]] }],
    button: { label: "Buy more time", url: "{{portal_url}}" },
  },
  {
    key: "owner.welcome",
    subject: "{{business_name}} is live on OgaWiFi",
    preheader: "Your hotspot business is set up. Here is where to find everything.",
    heading: "You&rsquo;re live",
    lead: `${EM("business_name")} is set up and ready to sell vouchers.`,
    blocks: [
      {
        kind: "rows",
        title: "Your account",
        rows: [
          ["Plan", "{{plan_name}}"],
          ["Monthly fee", "{{monthly_fee}}"],
          ["Your portal", "{{portal_url}}"],
        ],
      },
      {
        kind: "steps",
        title: "What to do next",
        items: [
          "Add a router and get it connected.",
          "Create a location, then the plans your customers will buy.",
          "Install the captive portal so customers land on your page.",
        ],
      },
    ],
    button: { label: "Open your dashboard", url: "{{admin_url}}" },
    note: `Stuck on any of it? We&rsquo;re at ${SUPPORT}.`,
  },
  {
    key: "owner.voucher_failed",
    subject: "A paid voucher needs your attention",
    preheader: "A customer paid but their access could not be set up.",
    heading: "A customer is waiting",
    lead: `Someone paid ${EM("business_name")} but creating their login on the router failed. They have been told it&rsquo;s being sorted.`,
    blocks: [
      { kind: "callout", tone: "alert", text: "They have already paid, so they&rsquo;re owed access. Retrying usually fixes it in one click." },
      {
        kind: "rows",
        title: "What failed",
        rows: [
          ["Customer", "{{customer_email}}"],
          ["Plan", "{{plan_name}}"],
          ["Location", "{{location_name}}"],
          ["Paid", "{{amount}}"],
          ["Reason", "{{failure_reason}}"],
        ],
      },
    ],
    button: { label: "Open failed queue", url: "{{failed_queue_url}}" },
  },
  {
    key: "owner.voucher_sold",
    subject: "You sold a {{plan_name}} voucher",
    preheader: "A customer paid and is online.",
    heading: "You made a sale",
    lead: `Someone bought a voucher from ${EM("business_name")} and their access is live.`,
    blocks: [
      {
        kind: "rows",
        title: "The sale",
        rows: [
          ["Customer", "{{customer_email}}"],
          ["Plan", "{{plan_name}}"],
          ["Location", "{{location_name}}"],
          ["They paid", "{{amount}}"],
          ["Your share", "{{tenant_share}}"],
        ],
      },
    ],
    button: { label: "View vouchers", url: "{{vouchers_url}}" },
  },
  {
    key: "owner.sales_digest",
    subject: "{{business_name}}: {{voucher_count}} sold on {{period}}",
    preheader: "Yesterday&rsquo;s voucher sales.",
    heading: "Yesterday&rsquo;s sales",
    lead: `Here is how ${EM("business_name")} did on ${EM("period")}.`,
    blocks: [
      {
        kind: "rows",
        title: "Totals",
        rows: [
          ["Vouchers sold", "{{voucher_count}}"],
          ["Customers paid", "{{gross_amount}}"],
          ["Your share", "{{tenant_share}}"],
        ],
      },
      {
        kind: "rows",
        title: "By location",
        rows: [["", "{{location_breakdown}}"]],
      },
    ],
    button: { label: "View vouchers", url: "{{vouchers_url}}" },
  },
  {
    key: "owner.limit_approaching",
    subject: "You&rsquo;re close to your {{limit_type}} limit",
    preheader: "Approaching a plan limit. New customers get blocked once you hit it.",
    heading: "Approaching your limit",
    lead: `${EM("business_name")} is close to the ${EM("limit_type")} limit on the ${EM("plan_name")} plan.`,
    blocks: [
      {
        kind: "rows",
        title: "Where you are",
        rows: [["Current", "{{current_count}}"], ["Limit", "{{limit_value}}"], ["Plan", "{{plan_name}}"]],
      },
      {
        kind: "callout",
        tone: "normal",
        text: "Once you reach the limit, brand new customers are turned away before they can pay. Existing customers can always keep buying.",
      },
    ],
    button: { label: "Review your plan", url: "{{billing_url}}" },
  },
  {
    key: "owner.limit_reached",
    subject: "You&rsquo;ve reached your {{limit_type}} limit",
    preheader: "New customers are now being turned away. Upgrade to keep selling.",
    heading: "You&rsquo;ve hit your limit",
    lead: `${EM("business_name")} has reached the ${EM("limit_type")} limit on the ${EM("plan_name")} plan.`,
    blocks: [
      {
        kind: "callout",
        tone: "alert",
        text: "Brand new customers are now turned away before they can pay. Existing customers can still buy as normal.",
      },
      { kind: "rows", title: "Your limit", rows: [["Limit", "{{limit_value}}"], ["Plan", "{{plan_name}}"]] },
    ],
    button: { label: "Upgrade your plan", url: "{{billing_url}}" },
  },
  {
    key: "owner.subscription_payment_failed",
    subject: "We couldn&rsquo;t take your subscription payment",
    preheader: "Your subscription payment failed. Update your card to stay active.",
    heading: "Payment didn&rsquo;t go through",
    lead: `We couldn&rsquo;t charge your card for ${EM("business_name")}.`,
    blocks: [
      { kind: "rows", title: "What&rsquo;s due", rows: [["Plan", "{{plan_name}}"], ["Amount", "{{amount}}"]] },
      {
        kind: "callout",
        tone: "alert",
        text: "Your account is past due. Settle it to avoid your portal being suspended, which takes every one of your hotspots offline.",
      },
    ],
    button: { label: "Fix your billing", url: "{{billing_url}}" },
    note: `If you think this is a mistake, get in touch at ${SUPPORT}.`,
  },
  {
    key: "owner.subscription_renewed",
    subject: "Your OgaWiFi subscription renewed",
    preheader: "Payment received. Here is when the next one is due.",
    heading: "Payment received",
    lead: `Thanks. Your subscription for ${EM("business_name")} renewed successfully.`,
    blocks: [
      {
        kind: "rows",
        title: "Receipt",
        rows: [["Plan", "{{plan_name}}"], ["Amount", "{{amount}}"], ["Next billing date", "{{next_billing_date}}"]],
      },
    ],
    button: { label: "View billing", url: "{{billing_url}}" },
  },
  {
    key: "owner.subscription_cancelled",
    subject: "Your OgaWiFi subscription is cancelled",
    preheader: "Your subscription will not renew.",
    heading: "Subscription cancelled",
    lead: `Your subscription for ${EM("business_name")} on the ${EM("plan_name")} plan will not renew.`,
    blocks: [
      {
        kind: "callout",
        tone: "normal",
        text: "Your hotspots keep working until the end of the period you&rsquo;ve already paid for. After that your portal is suspended and customers can&rsquo;t buy vouchers.",
      },
    ],
    button: { label: "Resubscribe", url: "{{billing_url}}" },
    note: `Changed your mind, or cancelled by accident? Reach us at ${SUPPORT}.`,
  },
  {
    key: "owner.account_suspended",
    subject: "{{business_name}} has been suspended",
    preheader: "Your portal is offline and customers cannot buy vouchers.",
    heading: "Your account is suspended",
    lead: `${EM("business_name")} has been suspended.`,
    blocks: [
      {
        kind: "callout",
        tone: "alert",
        text: "Your portal is offline, so customers can&rsquo;t buy vouchers at any of your locations. Customers who already have active vouchers stay connected.",
      },
    ],
    note: `Let&rsquo;s get this sorted. Contact ${SUPPORT} and we&rsquo;ll explain what&rsquo;s needed to restore your account.`,
  },
  {
    key: "owner.account_reactivated",
    subject: "{{business_name}} is back online",
    preheader: "Your account is active again and customers can buy vouchers.",
    heading: "You&rsquo;re back online",
    lead: `${EM("business_name")} is active again. Customers can buy vouchers at all of your locations.`,
    blocks: [],
    button: { label: "Open your portal", url: "{{portal_url}}" },
  },
  {
    key: "owner.router_offline",
    subject: "A router has gone offline",
    preheader: "One of your routers is unreachable. Sales at that location will fail.",
    heading: "A router is offline",
    lead: `We can&rsquo;t reach one of the routers for ${EM("business_name")}.`,
    blocks: [
      { kind: "callout", tone: "alert", text: "While it&rsquo;s offline, customers at this location can&rsquo;t buy vouchers and existing ones can&rsquo;t log in." },
      {
        kind: "rows",
        title: "Which one",
        rows: [["Router", "{{router_name}}"], ["Location", "{{location_name}}"], ["Last seen", "{{last_seen}}"]],
      },
    ],
    note: `Check the router has power and internet. Still stuck? Contact ${SUPPORT}.`,
  },
  {
    key: "platform.new_tenant",
    subject: "New tenant: {{business_name}}",
    preheader: "A new tenant completed onboarding.",
    heading: "New tenant signed up",
    lead: `${EM("business_name")} completed onboarding.`,
    blocks: [
      {
        kind: "rows",
        title: "Details",
        rows: [
          ["Business", "{{business_name}}"],
          ["Slug", "{{slug}}"],
          ["Owner", "{{owner_email}}"],
          ["Plan", "{{plan_name}}"],
          ["Monthly fee", "{{monthly_fee}}"],
        ],
      },
    ],
    button: { label: "Open their dashboard", url: "{{tenant_admin_url}}" },
  },
  {
    key: "platform.split_mismatch",
    subject: "Payment split mismatch on {{reference}}",
    preheader: "Paystack applied a different split than expected.",
    heading: "Payment split mismatch",
    lead: `Paystack applied a different revenue split than expected on a payment to ${EM("business_name")}. The payment was deliberately allowed to stand.`,
    blocks: [
      {
        kind: "rows",
        title: "The discrepancy",
        rows: [
          ["Reference", "{{reference}}"],
          ["Charge amount", "{{amount}}"],
          ["Expected tenant share", "{{expected_share}}"],
          ["Received tenant share", "{{received_share}}"],
        ],
      },
      { kind: "callout", tone: "alert", text: "Needs reconciling by hand. Nothing in the app corrects this automatically." },
    ],
  },
];

// Validation: a variable in a body that the send never supplies renders as an
// empty string in a real email, which is exactly the kind of thing nobody
// notices until a customer gets a blank where their password should be.
const ALWAYS = new Set(["app_url", "support_email", "year"]);
let problems = 0;
fs.mkdirSync(OUT, { recursive: true });

for (const def of DEFS) {
  const entry = EMAIL_CATALOG.find((e) => e.key === def.key);
  if (!entry) {
    console.log(`UNKNOWN KEY  ${def.key}`);
    problems++;
    continue;
  }
  const html = render(def);
  const used = new Set([...html.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]));
  const allowed = new Set<string>([...entry.variables, ...ALWAYS]);
  const undeclared = [...used].filter((v) => !allowed.has(v));
  const unused = [...entry.variables].filter((v) => !used.has(v));

  if (undeclared.length) { console.log(`UNDECLARED   ${def.key}: ${undeclared.join(", ")}`); problems++; }
  if (unused.length) console.log(`unused       ${def.key}: ${unused.join(", ")}`);
  if (html.includes("—") || html.includes("–")) { console.log(`DASH         ${def.key}`); problems++; }

  fs.writeFileSync(path.join(OUT, `${def.key}.html`), html, "utf8");
}

const missing = EMAIL_CATALOG.filter((e) => !DEFS.some((d) => d.key === e.key));
if (missing.length) { console.log(`NO TEMPLATE  ${missing.map((m) => m.key).join(", ")}`); problems++; }

// Subjects are plain text in Mailtrap, so the HTML entities the bodies use
// have to be decoded here or they render literally as "&rsquo;" in an inbox.
const plain = (v: string) =>
  v.replace(/&rsquo;/g, "\u2019").replace(/&amp;/g, "&").replace(/&middot;/g, "\u00b7");
const subjectDoc = [
  "# Mailtrap subjects",
  "",
  "Generated by `scripts/build-email-templates.mts`. Paste these into the",
  "subject field; the matching body is `<key>.html` in this directory.",
  "",
  "| Email key | Subject |",
  "| --- | --- |",
  ...DEFS.map((d) => `| \`${d.key}\` | ${plain(d.subject)} |`),
  "",
].join("\n");
fs.writeFileSync(path.join(OUT, "SUBJECTS.md"), subjectDoc, "utf8");

console.log(`\nwrote ${DEFS.length} templates to email-templates/`);
console.log(problems === 0 ? "all variables check out" : `${problems} problem(s) above`);
process.exit(0);
