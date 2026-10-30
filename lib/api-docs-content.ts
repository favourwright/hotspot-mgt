/**
 * The prose half of the developer docs: what is true of the whole API
 * rather than of one endpoint. Written as text, but every number in it is
 * the constant the code itself uses, so changing a limit changes the docs.
 *
 * Rendered twice from this one source: as Markdown into the OpenAPI
 * document's `info.description` (lib/openapi.ts) and as sections of the
 * /developers page. Endpoint and event details are not here; they come from
 * the routes' own declarations and the schemas.
 *
 * Formatting is a small Markdown subset the page renders itself: paragraphs,
 * `- ` lists, fenced code blocks, `code` and **bold**. Nothing else.
 */

import { API_SCOPES, MAX_ACTIVE_KEYS } from "@/lib/api-keys";
import {
  DAILY_READ_BUDGET,
  DEFAULT_PAGE_SIZE,
  ERROR_CATALOG,
  MAX_PAGE_SIZE,
  PER_KEY_LIMIT,
  PER_TENANT_LIMIT,
} from "@/lib/public-api";
import { RETRY_DELAYS_MS, DISABLE_AFTER_FAILING_MS, MAX_DELIVERY_ATTEMPTS } from "@/lib/webhook-events";
import { DELIVERY_TIMEOUT_MS, MAX_ENDPOINTS } from "@/lib/webhooks";
import { SIGNATURE_TOLERANCE_SECONDS, LINK_SIGNATURE_TOLERANCE_SECONDS } from "@/lib/hook-signing";
import {
  BREAKER_PROBE_INTERVAL_MS,
  BREAKER_THRESHOLD,
  MAX_HOOK_RESPONSE_BYTES,
  MAX_HOOK_TIMEOUT_MS,
} from "@/lib/decision-hook-contract";
import { LINK_STATE_TTL_MS } from "@/lib/hook-links";

/** The Introduction's opening, under the hero. */
export const INTRODUCTION =
  "The OgaWiFi API lets a business connect its own systems to its hotspot: read its plans, locations, vouchers, payments and customers, hear about sales the moment they happen through webhooks, and decide who may buy with decision hooks. Everything on this page is generated from the code that runs the API, so it is always current.";

/** The Introduction's note on formats, beside the example response. */
export const FORMAT_NOTE = `Requests and responses are JSON. Money is integer kobo, in fields named \`...Kobo\`; times are ISO 8601 in UTC. A success is \`{ "data": ... }\`, and a list adds \`"nextCursor"\`.`;

export interface DocSection {
  id: string;
  title: string;
  body: string;
}

function duration(ms: number): string {
  const minutes = ms / 60_000;
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return `${hours / 24} days`;
}

export function docSections(): DocSection[] {
  const errorRows = Object.entries(ERROR_CATALOG)
    .map(([code, { status, meaning }]) => `- **${status}** \`${code}\`: ${meaning}`)
    .join("\n");

  return [
    {
      id: "authentication",
      title: "Authentication",
      body: `Create a key at **Admin, then API keys**, with only the permissions the system using it needs. It is shown once. Send it on every request:

\`Authorization: Bearer ogw_live_...\`

Permissions: ${API_SCOPES.map((s) => `\`${s}\``).join(", ")}. Up to ${MAX_ACTIVE_KEYS} active keys per business. Revoking a key stops it on its very next request. Keep keys on your server, never in a website or an app someone can download.`,
    },
    {
      id: "responses",
      title: "Responses and errors",
      body: `A success is \`{ "data": ... }\`, and a list adds \`"nextCursor"\`. An error is \`{ "error": { "type", "code", "message", "requestId" } }\`. Every response carries \`x-request-id\`; quote it when asking for help.

${errorRows}

Fields are added within v1 without notice, so ignore fields you don't recognise. Anything that would break you becomes v2.`,
    },
    {
      id: "paging",
      title: "Paging",
      body: `Lists are newest first, \`limit\` per page (default ${DEFAULT_PAGE_SIZE}, max ${MAX_PAGE_SIZE}), paged by cursor only: pass the \`nextCursor\` you were given as \`cursor\`. A \`nextCursor\` of null means that was the last page. There are no totals and no page numbers. Money is integer kobo, in fields named \`...Kobo\`; times are ISO 8601 in UTC.`,
    },
    {
      id: "limits",
      title: "Limits",
      body: `- ${PER_KEY_LIMIT.max} requests a minute per key, ${PER_TENANT_LIMIT.max} a minute per business; over that, \`429 rate_limited\` with \`retry-after\`.
- **A daily read budget of ${DAILY_READ_BUDGET.toLocaleString("en-NG")} records per business.** Every record a request returns counts, and a list counts one extra. \`x-read-budget-remaining\` on every response says what is left; once spent, requests get \`429 daily_budget_exhausted\` until 00:00 UTC. Ask for changes since you last looked (\`from=\`) rather than re-reading everything.`,
    },
    {
      id: "webhooks",
      title: "Webhooks",
      body: `Set up at **Admin, then Webhooks**: up to ${MAX_ENDPOINTS} endpoints, each with the events it wants (none ticked means all, including ones added later). Every event is listed under Webhooks below, with its exact body.

Answer with any 2xx within ${DELIVERY_TIMEOUT_MS / 1000} seconds; anything else, a redirect or a timeout is a failure. **Deduplicate on \`id\`**: delivery is at least once, and one fact always has the same id. Events can arrive out of order; compare \`createdAt\` if order matters.

A failed delivery is retried after ${RETRY_DELAYS_MS.map(duration).join(", ")}: ${MAX_DELIVERY_ATTEMPTS} attempts in all. An endpoint that accepts nothing for ${duration(DISABLE_AFTER_FAILING_MS)} is switched off and its owner emailed; everything is still in the API.`,
    },
    {
      id: "signatures",
      title: "Signatures",
      body: `Everything we send you, webhooks and decision-hook calls, carries \`ogawifi-signature: t=<unix seconds>,v1=<hex>\`. To check it:

- read the **raw** body, before any JSON parsing;
- refuse it if \`t\` is more than ${SIGNATURE_TOLERANCE_SECONDS / 60} minutes old, or more than a minute in the future;
- compute HMAC-SHA256 of \`t\`, a dot, then the raw body, with that endpoint's or hook's signing secret, as hex;
- accept it if that equals any \`v1\`, compared in constant time (check lengths first).

\`\`\`js
const crypto = require("crypto");

function verifyOgaWiFi(rawBody, header, secret) {
  const parts = header.split(",").map((p) => p.trim());
  const t = Number(parts.find((p) => p.startsWith("t="))?.slice(2));
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(t) || now - t > ${SIGNATURE_TOLERANCE_SECONDS} || t - now > 60) return false;

  const expected = Buffer.from(
    crypto.createHmac("sha256", secret).update(\`\${t}.\${rawBody}\`).digest("hex")
  );
  return parts
    .filter((p) => p.startsWith("v1="))
    .some((p) => {
      const given = Buffer.from(p.slice(3));
      return given.length === expected.length && crypto.timingSafeEqual(given, expected);
    });
}
\`\`\`

With Express, keep the raw body: \`express.json({ verify: (req, _res, buf) => { req.rawBody = buf.toString("utf8"); } })\`.

After **New secret**, the old secret stays valid for 24 hours and every request carries two \`v1\` values. Don't allowlist our IP addresses; they aren't fixed. The signature is how you know it's us.`,
    },
    {
      id: "decision-hooks",
      title: "Decision hooks",
      body: `Before a customer pays, we ask your hook whether they may buy (\`voucher.pre_purchase\` under Webhooks below). Answer a 2xx within your timeout (at most ${MAX_HOOK_TIMEOUT_MS / 1000} seconds), at most ${MAX_HOOK_RESPONSE_BYTES / 1024} KB; anything else counts as your server failing, and the hook's own choice applies: stop the purchase, or let it through. After ${BREAKER_THRESHOLD} failures in a row we stop calling and keep applying that choice, trying once every ${BREAKER_PROBE_INTERVAL_MS / 1000} seconds until you answer.

Decide on \`customer.externalId\`, never on anything a customer types: an email proves nothing unless \`emailVerified\` is true. Answer \`"requireLink": true\` to have them verify on your **verification page**: we send them there with \`state\`, \`uid\` and \`callback\`, valid ${duration(LINK_STATE_TTL_MS)}. Send them back to \`callback\` with \`state\`, \`external_id\`, \`t\` and \`sig\`, an HMAC-SHA256 of \`t\`, a dot, \`state\`, a dot, then \`external_id\`, with the hook's secret, within ${LINK_SIGNATURE_TOLERANCE_SECONDS / 60} minutes. From then on every call carries your \`externalId\`.

\`\`\`js
// On your verification page, after your own login succeeds.
// Check query.callback starts with your OgaWiFi address first, or the page
// becomes a way to send people anywhere.
function callbackUrl(query, member, secret) {
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto
    .createHmac("sha256", secret)
    .update(\`\${t}.\${query.state}.\${member.id}\`)
    .digest("hex");
  const url = new URL(query.callback);
  url.searchParams.set("state", query.state);
  url.searchParams.set("external_id", member.id);
  url.searchParams.set("t", String(t));
  url.searchParams.set("sig", sig);
  return url.toString(); // redirect the browser here
}
\`\`\`

We store whatever you vouch for. If a member should only ever be linked to one account, remember the \`uid\` you linked them to and refuse a second. On the captive portal, your verification page's host is let through the router's walled garden automatically; anything it loads from other hosts is not, so keep it self-contained.`,
    },
  ];
}

/** The same sections as one Markdown string, for the OpenAPI document. */
export function docMarkdown(): string {
  return docSections()
    .map((s) => `## ${s.title}\n\n${s.body}`)
    .join("\n\n");
}
