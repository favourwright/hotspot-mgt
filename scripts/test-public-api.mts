/**
 * The public REST API: keys, authentication, what leaves the platform, and
 * the limits that protect the project's Firestore quota.
 *
 * Each case is a way the API could hand out more than it should. A key
 * split on `_` that accepts the wrong secret. A revoked key that still
 * reads. A 401 that says "revoked" and so confirms the key once existed. A
 * serializer that ships a voucher password because someone added a field.
 * A daily budget that never resets, or never runs out.
 *
 * Run: npm run test:public-api
 */
import {
  API_SCOPES,
  hashSecret,
  maskedKey,
  parseApiKey,
  randomBase62,
  secretMatches,
  type ApiKeyRecord,
} from "../lib/api-keys";
import {
  ApiError,
  DAILY_READ_BUDGET,
  MAX_PAGE_SIZE,
  authenticateRequest,
  budgetRemaining,
  chargeBudget,
  cursorParam,
  dateParam,
  enumParam,
  listMaxReads,
  pageSize,
} from "../lib/public-api";
import {
  publicCustomer,
  publicLocation,
  publicPayment,
  publicPlan,
  publicVoucher,
} from "../lib/public-api-serializers";
import type { Location, Payment, Plan, TenantCustomer, Voucher } from "../types/schemas";

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

async function status(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (error) {
    return error instanceof ApiError ? `${error.status} ${error.code}` : `threw ${String(error)}`;
  }
}

/* ------------------------------------------------ key format */

const id = randomBase62(16);
const secret = randomBase62(32);
const key = `ogw_live_${id}_${secret}`;

check("base62 only, right length", /^[0-9A-Za-z]{32}$/.test(randomBase62(32)), true);
check("two secrets differ", randomBase62(32) !== randomBase62(32), true);
check("a minted key parses", parseApiKey(key), { environment: "live", keyId: id, secret });
check("an underscore inside the secret is refused", parseApiKey(`ogw_live_${id}_${secret.slice(0, 31)}_`), null);
check("short secret refused", parseApiKey(`ogw_live_${id}_${secret.slice(1)}`), null);
check("test environment refused (no test mode)", parseApiKey(`ogw_test_${id}_${secret}`), null);
check("other prefix refused", parseApiKey(`sk_live_${id}_${secret}`), null);
check("trailing junk refused", parseApiKey(`${key}x`), null);
check("hash is SHA-256 hex", /^[0-9a-f]{64}$/.test(hashSecret(secret)), true);
check("right secret matches", secretMatches(secret, hashSecret(secret)), true);
check("wrong secret does not", secretMatches(randomBase62(32), hashSecret(secret)), false);
check("a corrupt stored hash is false, not a throw", secretMatches(secret, "abc"), false);
check("masked shows only id and last 4", maskedKey(id, secret.slice(-4)).endsWith(secret.slice(-4)) && !maskedKey(id, secret.slice(-4)).includes(secret.slice(0, 8)), true);

/* ------------------------------------------------ authentication */

function record(over: Partial<ApiKeyRecord> = {}): ApiKeyRecord {
  return {
    keyId: id,
    tenantId: "t1",
    name: "Sync",
    scopes: ["vouchers:read"],
    environment: "live",
    secretHash: hashSecret(secret),
    last4: secret.slice(-4),
    createdBy: "owner",
    createdAt: new Date(),
    revokedAt: null,
    lastUsedAt: null,
    requestCount: 0,
    ...over,
  };
}
const deps = (rec: ApiKeyRecord | null, access = true) => ({
  getKey: async (keyId: string) => (rec && rec.keyId === keyId ? rec : null),
  hasAccess: async () => access,
});

check("good key, right scope", await status(authenticateRequest(`Bearer ${key}`, "vouchers:read", deps(record()))), "ok");
check("tenant comes from the record", (await authenticateRequest(`Bearer ${key}`, "vouchers:read", deps(record()))).tenantId, "t1");

const UNIFORM = "401 invalid_api_key";
check("no header", await status(authenticateRequest(null, "vouchers:read", deps(record()))), UNIFORM);
check("not Bearer", await status(authenticateRequest(`Basic ${key}`, "vouchers:read", deps(record()))), UNIFORM);
check("malformed", await status(authenticateRequest("Bearer nonsense", "vouchers:read", deps(record()))), UNIFORM);
check("unknown key id", await status(authenticateRequest(`Bearer ${key}`, "vouchers:read", deps(null))), UNIFORM);
check("wrong secret for a real id",
  await status(authenticateRequest(`Bearer ogw_live_${id}_${randomBase62(32)}`, "vouchers:read", deps(record()))), UNIFORM);
check("revoked: the same 401, never 'revoked'",
  await status(authenticateRequest(`Bearer ${key}`, "vouchers:read", deps(record({ revokedAt: new Date() })))), UNIFORM);
check("addon lapsed: 402",
  await status(authenticateRequest(`Bearer ${key}`, "vouchers:read", deps(record(), false))), "402 api_access_required");
check("missing scope: 403",
  await status(authenticateRequest(`Bearer ${key}`, "payments:read", deps(record()))), "403 insufficient_scope");
check("scope check happens after the key is proven (bad key + wrong scope is 401)",
  await status(authenticateRequest("Bearer nonsense", "payments:read", deps(record()))), UNIFORM);
check("every scope is a read scope", API_SCOPES.every((s) => s.endsWith(":read")), true);

/* ------------------------------------------------ query parameters */

const u = (q: string) => new URL(`https://ogawifi.online/api/v1/vouchers${q}`);
check("default page size", pageSize(u("")), 25);
check("explicit page size", pageSize(u("?limit=50")), 50);
check("over the max refused", await status(Promise.resolve().then(() => pageSize(u(`?limit=${MAX_PAGE_SIZE + 1}`)))), "400 invalid_limit");
check("zero refused", await status(Promise.resolve().then(() => pageSize(u("?limit=0")))), "400 invalid_limit");
check("fractional refused", await status(Promise.resolve().then(() => pageSize(u("?limit=2.5")))), "400 invalid_limit");
check("a list may read one more than it returns", listMaxReads(u("?limit=10")), 11);
check("payment-id cursor accepted (hs_ ids have underscores)", cursorParam(u("?cursor=1761818400000_hs_1761818400000_0123456789abcdef")), "1761818400000_hs_1761818400000_0123456789abcdef");
check("garbage cursor refused", await status(Promise.resolve().then(() => cursorParam(u("?cursor=../../etc")))), "400 invalid_cursor");
check("status filter", enumParam(u("?status=failed"), "status", ["active", "failed"] as const), "failed");
check("unknown status refused", await status(Promise.resolve().then(() => enumParam(u("?status=deleted"), "status", ["active"] as const))), "400 invalid_status");
check("ISO date", dateParam(u("?from=2026-10-01"), "from")?.toISOString(), "2026-10-01T00:00:00.000Z");
check("bad date refused", await status(Promise.resolve().then(() => dateParam(u("?from=yesterday"), "from"))), "400 invalid_from");

/* ------------------------------------------------ the daily read budget */

const day1 = Date.parse("2026-10-30T10:00:00.000Z");
check("a fresh day has the full budget", budgetRemaining("tb", day1), DAILY_READ_BUDGET);
chargeBudget("tb", 51, day1);
check("charges what was actually read", budgetRemaining("tb", day1), DAILY_READ_BUDGET - 51);
check("one tenant's spending is not another's", budgetRemaining("tc", day1), DAILY_READ_BUDGET);
chargeBudget("tb", DAILY_READ_BUDGET, day1);
check("can be exhausted", budgetRemaining("tb", day1) <= 0, true);
check("resets at 00:00 UTC", budgetRemaining("tb", Date.parse("2026-10-31T00:00:01.000Z")), DAILY_READ_BUDGET);

/* ------------------------------------------------ what leaves the platform */

const now = new Date("2026-10-30T10:00:00.000Z");
const voucher = {
  id: "v1", userId: "u1", userEmail: "a@b.c", planId: "p1", planName: "Daily", locationId: "l1",
  locationName: "Main", tenantId: "t1", username: "ada-4821", password: "SECRET-PASSWORD",
  duration: "1 day", deviceMac: "AA:BB:CC:DD:EE:FF", status: "active", paystackReference: "hs_1_x",
  createdAt: now, expiresAt: null, renewalOf: null,
} as unknown as Voucher;
const payment = {
  id: "hs_1_x", userId: "u1", userEmail: "a@b.c", planId: "p1", planName: "Daily", locationId: "l1",
  tenantId: "t1", amount: 50750, paystackReference: "hs_1_x", status: "success", voucherId: "v1",
  subaccountCode: "ACCT_SECRET", platformShareKobo: 5000, tenantShareKobo: 45750, createdAt: now,
} as unknown as Payment;
const location = {
  id: "l1", name: "Main", routerId: "r1", active: true, createdAt: now,
  portalHtmlDirectory: "flash/hotspot", routerIp: "10.10.0.5",
} as unknown as Location;
const plan = {
  id: "p1", locationId: "l1", locationName: "Main", name: "Daily", price: 50000, duration: "1 day",
  routerDurationValue: 1, routerDurationUnit: "d", mikrotikProfile: "daily-prof", active: true,
  sameCredentials: true, createdAt: now,
} as unknown as Plan;
const customer = { uid: "u1", email: "a@b.c", totalVouchers: 3, totalSpent: 150000, joinedAt: now } as TenantCustomer;

const out = JSON.stringify([
  publicVoucher(voucher), publicPayment(payment), publicLocation(location), publicPlan(plan), publicCustomer(customer, "MEMBER-1"),
]);
for (const forbidden of ["SECRET-PASSWORD", "password", "AA:BB:CC", "deviceMac", "ACCT_SECRET", "subaccount", "platformShare", "routerId", "10.10.0.5", "mikrotikProfile", "daily-prof", "portalHtmlDirectory"]) {
  check(`never leaves: ${forbidden}`, out.includes(forbidden), false);
}
check("voucher login name is included", publicVoucher(voucher).username, "ada-4821");
check("money is kobo, named so", [publicPayment(payment).amountKobo, publicPlan(plan).priceKobo], [50750, 50000]);
check("tenant's own share is included", publicPayment(payment).tenantShareKobo, 45750);
check("times are ISO UTC", publicPayment(payment).createdAt, "2026-10-30T10:00:00.000Z");
check("customer carries the linked id", publicCustomer(customer, "MEMBER-1").externalId, "MEMBER-1");

console.log(`\n${total - failed}/${total} passed`);
process.exit(failed > 0 ? 1 : 0);
