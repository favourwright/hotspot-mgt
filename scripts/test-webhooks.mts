/**
 * Outbound webhooks: one event per fact, a retry schedule that gives up,
 * signatures a tenant can verify, and no writes for nobody.
 *
 * The failures this guards against are quiet ones. Three fulfilment paths
 * each recording their own `voucher.issued`, so a tenant books a sale three
 * times. A retry schedule with no end. An endpoint switched off after one
 * bad minute, or never. A payload that drifts from the API's own voucher.
 * Events written for tenants with nobody listening, on a project whose
 * daily write quota is shared by everything.
 *
 * Run: npm run test:webhooks
 */
import { randomBytes } from "node:crypto";

process.env.HOOK_SECRETS_KEY = randomBytes(32).toString("base64");

const events = await import("../lib/webhook-events");
const webhooks = await import("../lib/webhooks");
const secrets = await import("../lib/hook-secrets");
const { verifySignatureHeader } = await import("../lib/hook-signing");
const { publicVoucher, publicPayment } = await import("../lib/public-api-serializers");
const { SafeFetchError } = await import("../lib/safe-fetch");

let failed = 0;
let total = 0;

function check(name: string, got: unknown, want: unknown) {
  total += 1;
  const g = typeof got === "object" && got !== null ? JSON.stringify(got) : String(got);
  const w = typeof want === "object" && want !== null ? JSON.stringify(want) : String(want);
  const ok = g === w;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(66)} ${g.slice(0, 50)}`);
  if (!ok) console.log(`      wanted: ${w}`);
}

/* ------------------------------------------------ one event per fact */

const a = events.webhookEventId("voucher.issued", "v1");
check("same fact, same id (browser, webhook and cron agree)", events.webhookEventId("voucher.issued", "v1"), a);
check("different voucher, different id", events.webhookEventId("voucher.issued", "v2") !== a, true);
check("same voucher, different event type, different id", events.webhookEventId("voucher.failed", "v1") !== a, true);
check("id is opaque and Firestore-safe", /^evt_[0-9a-f]{32}$/.test(a), true);

/* ------------------------------------------------ retries */

const delays = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => events.nextAttemptDelayMs(n));
check("backs off: 1m, 5m, 30m, 2h, 6h, 12h, 24h, then stop",
  delays.map((d) => (d === null ? null : d / 60_000)), [1, 5, 30, 120, 360, 720, 1440, null]);
check("eight attempts in all", events.MAX_DELIVERY_ATTEMPTS, 8);

const now = new Date("2026-10-30T12:00:00.000Z");
const fail = { ok: false, httpStatus: 503, error: "HTTP 503" };
const okResult = { ok: true, httpStatus: 200, error: null };
check("first failure: retry in a minute",
  webhooks.deliveryOutcome(0, fail, now), { status: "pending", attempts: 1, nextAttemptAt: new Date(now.getTime() + 60_000) });
check("success: delivered, no next attempt",
  webhooks.deliveryOutcome(3, okResult, now), { status: "succeeded", attempts: 4, nextAttemptAt: null });
check("eighth failure: give up",
  webhooks.deliveryOutcome(7, fail, now), { status: "failed", attempts: 8, nextAttemptAt: null });

/* ------------------------------------------------ switching endpoints off */

const day = 24 * 3600_000;
check("never failing: stays on", events.shouldDisableEndpoint(null, now), false);
check("failing two days: stays on", events.shouldDisableEndpoint(new Date(now.getTime() - 2 * day), now), false);
check("failing three days: switched off", events.shouldDisableEndpoint(new Date(now.getTime() - 3 * day), now), true);

/* ------------------------------------------------ subscriptions */

check("no list means every event", events.endpointWants([], "payment.succeeded"), true);
check("a list filters", events.endpointWants(["voucher.issued"], "payment.succeeded"), false);
check("listed event is sent", events.endpointWants(["voucher.issued"], "voucher.issued"), true);
check("the test event always reaches the endpoint being tested", events.endpointWants(["voucher.issued"], events.TEST_EVENT_TYPE), true);

/* ------------------------------------------------ payloads match the API */

const created = new Date("2026-10-30T10:00:00.000Z");
const voucher = publicVoucher({
  id: "v1", userId: "u1", userEmail: "a@b.c", planId: "p1", planName: "Daily", locationId: "l1",
  locationName: "Main", tenantId: "t1", username: "ada-4821", password: "SECRET", duration: "1 day",
  status: "active", reference: "hs_1_x", createdAt: created, expiresAt: null, renewalOf: null,
} as never);
const payment = publicPayment({
  id: "hs_1_x", userId: "u1", userEmail: "a@b.c", planId: "p1", planName: "Daily", locationId: "l1",
  tenantId: "t1", amount: 50750, reference: "hs_1_x", status: "success", voucherId: "v1",
  payeeReference: "ACCT", platformShareKobo: 5000, tenantShareKobo: 45750, createdAt: created,
} as never);
// Strict at every level: `.strict()` on the outer object alone would let an
// undocumented field inside the voucher through.
const { PublicVoucherSchema, PublicPaymentSchema } = await import("../lib/api-schemas");
for (const type of ["voucher.issued", "voucher.renewed", "voucher.failed"] as const) {
  check(`${type} payload matches its published schema`,
    events.WEBHOOK_EVENTS[type].data.strict().safeParse({ voucher }).success &&
      PublicVoucherSchema.strict().safeParse(voucher).success, true);
}
check("payment.succeeded payload matches its published schema",
  events.WEBHOOK_EVENTS["payment.succeeded"].data.strict().safeParse({ payment }).success &&
    PublicPaymentSchema.strict().safeParse(payment).success, true);
check("a webhook voucher never carries the password", JSON.stringify(voucher).includes("SECRET"), false);

const body = events.webhookBody({ id: a, type: "voucher.issued", createdAt: created, data: { voucher } });
check("body carries version, id, type, time and data",
  Object.keys(JSON.parse(body)), ["apiVersion", "id", "type", "createdAt", "data"]);

/* ------------------------------------------------ sending, signed */

const enc = secrets.encryptHookSecret("whsec_endpoint");
const endpoint = {
  url: "https://hooks.tenant.example/ogawifi",
  secretCiphertext: enc.ciphertext,
  secretKeyVersion: enc.keyVersion,
  previousSecretCiphertext: null,
  previousSecretKeyVersion: null,
  previousSecretExpiresAt: null,
};
const NOW_MS = Date.parse("2026-10-30T12:00:00.000Z");
let sent: { headers: Record<string, string>; body: string } | null = null;
const deps = (reply: () => { status: number; body: string } | Error) => ({
  now: () => NOW_MS,
  fetch: async (_url: string, options: { headers: Record<string, string>; body?: string }) => {
    sent = { headers: options.headers, body: options.body ?? "" };
    const r = reply();
    if (r instanceof Error) throw r;
    return { status: r.status, ok: r.status >= 200 && r.status < 300, body: r.body };
  },
});

const delivered = await webhooks.sendWebhook(endpoint, { id: "d1", type: "voucher.issued", attempt: 2 }, body, deps(() => ({ status: 204, body: "" })));
check("a 2xx is delivered", delivered.ok, true);
check("signature verifies with the receiver code from the docs",
  verifySignatureHeader(sent!.headers["ogawifi-signature"], "whsec_endpoint", sent!.body, NOW_MS / 1000), true);
check("headers name the event, delivery and attempt",
  [sent!.headers["ogawifi-event"], sent!.headers["ogawifi-delivery"], sent!.headers["ogawifi-delivery-attempt"]],
  ["voucher.issued", "d1", "2"]);
check("the exact bytes signed are the bytes sent", sent!.body, body);

check("a 500 is a failure to retry",
  (await webhooks.sendWebhook(endpoint, { id: "d1", type: "x", attempt: 1 }, body, deps(() => ({ status: 500, body: "" })))).error, "HTTP 500");
check("a redirect is a failure (never followed)",
  (await webhooks.sendWebhook(endpoint, { id: "d1", type: "x", attempt: 1 }, body, deps(() => ({ status: 301, body: "" })))).ok, false);
check("a timeout is a failure, not a throw",
  (await webhooks.sendWebhook(endpoint, { id: "d1", type: "x", attempt: 1 }, body, deps(() => new SafeFetchError("Timed out", "timeout")))).error, "Timed out");
check("an SSRF refusal is a failure, not a throw",
  (await webhooks.sendWebhook(endpoint, { id: "d1", type: "x", attempt: 1 }, body, deps(() => new SafeFetchError("resolves to an address hooks may not reach", "address")))).ok, false);

{
  const old = secrets.encryptHookSecret("whsec_previous");
  await webhooks.sendWebhook(
    { ...endpoint, previousSecretCiphertext: old.ciphertext, previousSecretKeyVersion: 1, previousSecretExpiresAt: new Date(NOW_MS + 60_000) },
    { id: "d1", type: "x", attempt: 1 }, body, deps(() => ({ status: 200, body: "" })));
  check("during rotation the previous secret still verifies",
    verifySignatureHeader(sent!.headers["ogawifi-signature"], "whsec_previous", sent!.body, NOW_MS / 1000), true);
}

/* ------------------------------------------------ no writes for nobody */

{
  const deferred: string[] = [];
  const base = {
    tenantId: "t1", type: "voucher.issued" as const, subjectId: "v1", data: { voucher },
  };
  const none = await webhooks.emitWebhookEvent(base, {
    loadEndpoints: async () => [],
    hasAccess: async () => true,
    defer: () => void deferred.push("x"),
  });
  check("no endpoints: nothing recorded", none, { eventId: null, deliveries: 0 });

  const unsubscribed = await webhooks.emitWebhookEvent(base, {
    loadEndpoints: async () => [{ active: true, events: ["payment.succeeded"] } as never],
    hasAccess: async () => true,
    defer: () => void deferred.push("x"),
  });
  check("no endpoint wants this event: nothing recorded", unsubscribed, { eventId: null, deliveries: 0 });

  const switchedOff = await webhooks.emitWebhookEvent(base, {
    loadEndpoints: async () => [{ active: false, events: [] } as never],
    hasAccess: async () => true,
    defer: () => void deferred.push("x"),
  });
  check("only switched-off endpoints: nothing recorded", switchedOff, { eventId: null, deliveries: 0 });

  const lapsed = await webhooks.emitWebhookEvent(base, {
    loadEndpoints: async () => [{ active: true, events: [] } as never],
    hasAccess: async () => false,
    defer: () => void deferred.push("x"),
  });
  check("addon lapsed: nothing recorded", lapsed, { eventId: null, deliveries: 0 });
  check("and no delivery was attempted", deferred.length, 0);
}

console.log(`\n${total - failed}/${total} passed`);
process.exit(failed > 0 ? 1 : 0);
