/**
 * Decision hooks: the contract, the breaker, signing, secret encryption,
 * and the whole run against a fake tenant server.
 *
 * Each case is a way a tenant's rule could silently stop being enforced, or
 * enforce something nobody asked for. The string "false" counted as a yes.
 * A 500 that happens to say `allowed: true` counted as approval. A breaker
 * that turns a block hook off when the tenant's server is down. A signature
 * a receiver cannot verify, or one that can be replayed next week.
 *
 * Run: npm run test:decision-hooks
 */
import { randomBytes } from "node:crypto";

process.env.HOOK_SECRETS_KEY = randomBytes(32).toString("base64");

const contract = await import("../lib/decision-hook-contract");
const signing = await import("../lib/hook-signing");
const secrets = await import("../lib/hook-secrets");
const hooks = await import("../lib/decision-hooks");
const { SafeFetchError } = await import("../lib/safe-fetch");
const links = await import("../lib/hook-links");

let failed = 0;
let total = 0;

function check(name: string, got: unknown, want: unknown) {
  total += 1;
  const g = typeof got === "object" && got !== null ? JSON.stringify(got) : String(got);
  const w = typeof want === "object" && want !== null ? JSON.stringify(want) : String(want);
  const ok = g === w;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(68)} ${g.slice(0, 60)}`);
  if (!ok) console.log(`      wanted: ${w}`);
}

const { parseHookResponse: parse } = contract;

/* ------------------------------------------------ the response contract */

check("allowed true", parse(200, '{"allowed":true}').kind, "allow");
check("allowed false with reason", parse(200, '{"allowed":false,"reason":"Under 18","code":"AGE"}'),
  { kind: "block", reason: "Under 18", code: "AGE", requireLink: false });
check("string \"false\" is not an answer", parse(200, '{"allowed":"false"}').kind, "invalid");
check("string \"true\" is not an answer", parse(200, '{"allowed":"true"}').kind, "invalid");
check("1 is not true", parse(200, '{"allowed":1}').kind, "invalid");
check("missing allowed", parse(200, '{"ok":true}').kind, "invalid");
check("500 carrying allowed:true is a failure", parse(500, '{"allowed":true}').kind, "invalid");
check("302 is a failure", parse(302, "").kind, "invalid");
check("204 with no body is a failure (no answer)", parse(204, "").kind, "invalid");
check("not JSON", parse(200, "<html>ok</html>").kind, "invalid");
check("JSON array", parse(200, "[true]").kind, "invalid");
check("JSON null", parse(200, "null").kind, "invalid");
check("201 counts as 2xx", parse(201, '{"allowed":true}').kind, "allow");
check("extra fields are ignored", parse(200, '{"allowed":true,"price":1}').kind, "allow");

const long = "x".repeat(500);
const blockedLong = parse(200, JSON.stringify({ allowed: false, reason: long }));
check("reason capped at 200", blockedLong.kind === "block" ? blockedLong.reason.length : -1, 200);
check("reason flattened to one line",
  contract.sanitizeReason("  Line one\n\tline\u0000two  "), "Line one line two");
check("empty reason gets the default", contract.sanitizeReason("   "), contract.DEFAULT_BLOCK_REASON);
check("non-string reason gets the default", contract.sanitizeReason({ html: "<b>" }), contract.DEFAULT_BLOCK_REASON);
check("tidy code kept", contract.sanitizeCode("AGE_RESTRICTION"), "AGE_RESTRICTION");
check("untidy code dropped", contract.sanitizeCode("age restriction!"), null);
check("overlong code dropped", contract.sanitizeCode("A".repeat(65)), null);

/* ------------------------------------------------ filters */

check("no filters covers everything",
  contract.hookApplies({ planIds: null, locationIds: null }, "p1", "l1"), true);
check("plan filter excludes other plans",
  contract.hookApplies({ planIds: ["p2"], locationIds: null }, "p1", "l1"), false);
check("plan filter includes its plan",
  contract.hookApplies({ planIds: ["p1", "p2"], locationIds: null }, "p1", "l1"), true);
check("location filter excludes other locations",
  contract.hookApplies({ planIds: null, locationIds: ["l2"] }, "p1", "l1"), false);
check("empty list means everything",
  contract.hookApplies({ planIds: [], locationIds: [] }, "p1", "l1"), true);

/* ------------------------------------------------ breaker */

{
  let t = 1_000_000;
  const b = new contract.CircuitBreaker(() => t);
  for (let i = 0; i < 9; i += 1) b.recordFailure("h");
  check("9 failures: still calling", b.before("h"), "call");
  check("10th failure trips", b.recordFailure("h"), true);
  check("open: not called", b.before("h"), "open");
  check("a further failure does not re-trip", b.recordFailure("h"), false);

  t += contract.BREAKER_PROBE_INTERVAL_MS;
  check("after the interval: one probe", b.before("h"), "probe");
  check("only one probe at a time", b.before("h"), "open");
  b.recordFailure("h"); // the probe failed
  check("failed probe: still open", b.before("h"), "open");

  t += contract.BREAKER_PROBE_INTERVAL_MS;
  check("next interval: probe again", b.before("h"), "probe");
  check("successful probe closes it, and says so", b.recordSuccess("h"), true);
  check("closed: calling again", b.before("h"), "call");
  check("counter cleared on close", b.state("h").failures, 0);
}
{
  let t = 0;
  const b = new contract.CircuitBreaker(() => t);
  for (let i = 0; i < 9; i += 1) b.recordFailure("h");
  t += contract.BREAKER_FAILURE_WINDOW_MS + 1;
  check("failures older than the window stop counting", b.recordFailure("h"), false);
  check("so the count restarts", b.state("h").failures, 1);
}
{
  const b = new contract.CircuitBreaker(() => 0);
  for (let i = 0; i < 9; i += 1) b.recordFailure("h");
  b.recordSuccess("h");
  b.recordFailure("h");
  check("a success in between resets: not consecutive", b.state("h").failures, 1);
  check("success on a closed breaker reports no recovery", b.recordSuccess("h"), false);
}
{
  const b = new contract.CircuitBreaker(() => 0, 3);
  for (const id of ["a", "b", "c", "d"]) b.recordFailure(id);
  check("bounded: oldest entry dropped", b.state("a").failures, 0);
  check("bounded: newest kept", b.state("d").failures, 1);
}

/* ------------------------------------------------ signing */

const NOW = 1_761_739_200;
const body = '{"id":"req_1","event":"voucher.pre_purchase"}';
const header = signing.signatureHeader(["whsec_a"], NOW, body);
check("header shape", /^t=\d+,v1=[0-9a-f]{64}$/.test(header), true);
check("verifies with the right secret", signing.verifySignatureHeader(header, "whsec_a", body, NOW), true);
check("fails with the wrong secret", signing.verifySignatureHeader(header, "whsec_b", body, NOW), false);
check("fails if the body changed by a byte",
  signing.verifySignatureHeader(header, "whsec_a", body.replace("1", "2"), NOW), false);
check("fails when stale (replay)",
  signing.verifySignatureHeader(header, "whsec_a", body, NOW + 301), false);
check("fails when from the future",
  signing.verifySignatureHeader(header, "whsec_a", body, NOW - 61), false);
check("tolerates a minute of clock skew",
  signing.verifySignatureHeader(header, "whsec_a", body, NOW - 60), true);
check("a re-timestamped replay fails (time is signed)",
  signing.verifySignatureHeader(header.replace(`t=${NOW}`, `t=${NOW + 100}`), "whsec_a", body, NOW + 100), false);
check("garbage header fails, does not throw",
  signing.verifySignatureHeader("v1=short", "whsec_a", body, NOW), false);
const rotating = signing.signatureHeader(["whsec_new", "whsec_old"], NOW, body);
check("rotation: two signatures sent", rotating.split("v1=").length - 1, 2);
check("rotation: old secret still verifies", signing.verifySignatureHeader(rotating, "whsec_old", body, NOW), true);
check("rotation: new secret verifies", signing.verifySignatureHeader(rotating, "whsec_new", body, NOW), true);

/* ------------------------------------------------ secrets at rest */

const plain = secrets.generateHookSecret();
check("secret shape", /^whsec_[A-Za-z0-9_-]{43}$/.test(plain), true);
const enc = secrets.encryptHookSecret(plain);
check("ciphertext does not contain the secret", enc.ciphertext.includes(plain.slice(6)), false);
check("round trip", secrets.decryptHookSecret(enc.ciphertext, enc.keyVersion), plain);
check("two encryptions differ (random IV)", secrets.encryptHookSecret(plain).ciphertext !== enc.ciphertext, true);
{
  const [iv, tag, ct] = enc.ciphertext.split(".");
  const flipped = Buffer.from(ct, "base64");
  flipped[0] ^= 1;
  let threw = false;
  try {
    secrets.decryptHookSecret([iv, tag, flipped.toString("base64")].join("."), 1);
  } catch {
    threw = true;
  }
  check("tampered ciphertext is refused", threw, true);
}
{
  const saved = process.env.HOOK_SECRETS_KEY;
  process.env.HOOK_SECRETS_KEY = "";
  check("unconfigured key is reported", secrets.hookSecretsConfigured(), false);
  let threw = "";
  try {
    secrets.encryptHookSecret("x");
  } catch (error) {
    threw = (error as Error).name;
  }
  check("and encrypting refuses", threw, "HookSecretsUnavailableError");
  process.env.HOOK_SECRETS_KEY = saved;
}

/* ------------------------------------------------ the whole run */

function makeHook(
  over: Partial<import("../lib/decision-hooks").DecisionHook> = {}
): import("../lib/decision-hooks").DecisionHook {
  const e = secrets.encryptHookSecret("whsec_tenant");
  return {
    id: `hook_${Math.random().toString(36).slice(2)}`,
    tenantId: "t1",
    name: "Eligibility",
    event: contract.HOOK_EVENT,
    url: "https://hooks.tenant.example/check",
    linkUrl: null,
    walledGardenSync: null,
    secretCiphertext: e.ciphertext,
    secretKeyVersion: e.keyVersion,
    previousSecretCiphertext: null,
    previousSecretKeyVersion: null,
    previousSecretExpiresAt: null,
    timeoutMs: 2000,
    failStrategy: "block" as const,
    planIds: null,
    locationIds: null,
    active: true,
    breakerAlertedAt: null,
    createdAt: null,
    updatedAt: null,
    createdBy: "owner",
    ...over,
  };
}

let ctxSeq = 0;
function ctx() {
  ctxSeq += 1;
  return {
    tenantId: "t1",
    customer: { uid: `u${ctxSeq}`, email: "buyer@example.com", emailVerified: false },
    plan: { id: "p1", name: "Daily", priceKobo: 50000 },
    location: { id: "l1", name: "Main" },
    intent: "reuse" as const,
  };
}

type Reply = { status: number; body: string } | Error;

function world(
  hook: ReturnType<typeof makeHook> | null,
  reply: () => Reply,
  externalId: string | null = null
) {
  const sent: Array<{ headers: Record<string, string>; body: string }> = [];
  const logs: string[] = [];
  const alerts: string[] = [];
  const deps: import("../lib/decision-hooks").HookDeps = {
    loadHooks: async () => (hook ? [hook] : []),
    loadExternalId: async () => externalId,
    fetch: async (_url, options) => {
      sent.push({ headers: options.headers, body: options.body ?? "" });
      const r = reply();
      if (r instanceof Error) throw r;
      return { status: r.status, ok: r.status >= 200 && r.status < 300, body: r.body };
    },
    now: () => NOW * 1000,
    defer: (task) => void task(),
    log: async (entry) => void logs.push(entry.outcome),
    alertFailing: async () => void alerts.push("failing"),
    alertRecovered: async () => void alerts.push("recovered"),
  };
  return { deps, sent, logs, alerts };
}

{
  const w = world(null, () => ({ status: 200, body: '{"allowed":true}' }));
  const d = await hooks.runPrePurchaseHook(ctx(), w.deps);
  check("no hook: allowed without a call", [d.allowed, d.outcome, w.sent.length], [true, "no_hook", 0]);
}
{
  const w = world(makeHook({ active: false }), () => ({ status: 200, body: '{"allowed":false}' }));
  const d = await hooks.runPrePurchaseHook(ctx(), w.deps);
  check("inactive hook is not called", [d.allowed, w.sent.length], [true, 0]);
}
{
  const w = world(makeHook({ planIds: ["other"] }), () => ({ status: 200, body: '{"allowed":false}' }));
  const d = await hooks.runPrePurchaseHook(ctx(), w.deps);
  check("hook for other plans is not called", [d.allowed, w.sent.length], [true, 0]);
}
{
  const w = world(makeHook(), () => ({ status: 200, body: '{"allowed":true}' }));
  const c = ctx();
  const d = await hooks.runPrePurchaseHook(c, w.deps);
  check("allowed", [d.allowed, d.outcome], [true, "allowed"]);
  const sentBody = JSON.parse(w.sent[0].body);
  check("payload carries version, event and ids only",
    [sentBody.apiVersion, sentBody.event, sentBody.data.customer, sentBody.data.plan.priceKobo],
    [contract.HOOK_API_VERSION, "voucher.pre_purchase", { ...c.customer, externalId: null }, 50000]);
  check("an unverified email says so", sentBody.data.customer.emailVerified, false);
  check("no test flag on a live call", "test" in sentBody, false);
  check("the real request body matches its published schema, strictly",
    contract.DecisionHookRequestSchema.safeParse(sentBody).success, true);
  check("signature verifies against the exact bytes sent",
    signing.verifySignatureHeader(w.sent[0].headers["ogawifi-signature"], "whsec_tenant", w.sent[0].body, NOW), true);
  check("request id header matches the body", w.sent[0].headers["ogawifi-request-id"], sentBody.id);
  check("logged once", w.logs, ["allowed"]);

  const again = await hooks.runPrePurchaseHook(c, w.deps);
  check("a double tap reuses the allow: no second call", [again.outcome, w.sent.length], ["cached", 1]);
}
{
  const w = world(makeHook(), () => ({ status: 200, body: '{"allowed":false,"reason":"Members only","code":"NOT_MEMBER"}' }));
  const c = ctx();
  const d = await hooks.runPrePurchaseHook(c, w.deps);
  check("blocked with the tenant's reason",
    d.allowed ? "allowed" : [d.reason, d.code, d.outcome], ["Members only", "NOT_MEMBER", "blocked"]);
  await hooks.runPrePurchaseHook(c, w.deps);
  check("blocks are not cached: asked again", w.sent.length, 2);
}
for (const [label, reply] of [
  ["timeout", () => new SafeFetchError("Timed out", "timeout")],
  ["500 with allowed:true", () => ({ status: 500, body: '{"allowed":true}' })],
  ["string \"true\"", () => ({ status: 200, body: '{"allowed":"true"}' })],
  ["SSRF refusal", () => new SafeFetchError("resolves to an address hooks may not reach", "address")],
] as const) {
  const block = world(makeHook({ failStrategy: "block" }), reply as () => Reply);
  const b = await hooks.runPrePurchaseHook(ctx(), block.deps);
  check(`${label}, block strategy: purchase refused`,
    b.allowed ? "allowed" : [b.code, b.reason === contract.UNAVAILABLE_REASON], ["HOOK_UNAVAILABLE", true]);
  check(`${label}: logged exactly once`, block.logs, ["failed"]);

  const allow = world(makeHook({ failStrategy: "allow" }), reply as () => Reply);
  const a = await hooks.runPrePurchaseHook(ctx(), allow.deps);
  check(`${label}, allow strategy: purchase goes ahead`, [a.allowed, a.outcome], [true, "failed"]);
}
{
  // The breaker trips and keeps enforcing a block hook without calling it.
  const hook = makeHook({ failStrategy: "block" });
  const w = world(hook, () => ({ status: 503, body: "down" }));
  for (let i = 0; i < 10; i += 1) await hooks.runPrePurchaseHook(ctx(), w.deps);
  check("ten failures trip the breaker, alerting once", w.alerts, ["failing"]);
  const calls = w.sent.length;
  const d = await hooks.runPrePurchaseHook(ctx(), w.deps);
  check("open breaker on a block hook: still refused", d.allowed, false);
  check("and the tenant's server is not called", w.sent.length, calls);
  check("logged as breaker_open", w.logs.at(-1), "breaker_open");
  hooks.breaker.reset(hook.id);
}
{
  const hook = makeHook();
  const w = world(hook, () => ({ status: 200, body: '{"allowed":true}' }));
  // Nine failures, one short of tripping. (Probing and closing an open
  // breaker is covered by the CircuitBreaker cases above, with a clock.)
  for (let i = 0; i < 9; i += 1) hooks.breaker.recordFailure(hook.id);
  const d = await hooks.runPrePurchaseHook(ctx(), w.deps);
  check("a success before the 10th failure: allowed, no alerts", [d.allowed, w.alerts.length], [true, 0]);
  check("and the count is cleared", hooks.breaker.state(hook.id).failures, 0);
}
{
  const w = world(makeHook(), () => ({ status: 200, body: '{"allowed":true}' }));
  const t = await hooks.testHook(makeHook(), ctx(), w.deps);
  check("test call is flagged test:true", JSON.parse(w.sent[0].body).test, true);
  check("and still matches the published schema", contract.DecisionHookRequestSchema.safeParse(JSON.parse(w.sent[0].body)).success, true);
  check("test call is logged as a test", w.logs, ["test"]);
  check("test call reports the verdict", t.verdict.kind, "allow");
}
{
  const old = secrets.encryptHookSecret("whsec_old");
  const hook = makeHook({
    previousSecretCiphertext: old.ciphertext,
    previousSecretKeyVersion: 1,
    previousSecretExpiresAt: new Date(NOW * 1000 + 60_000),
  });
  const w = world(hook, () => ({ status: 200, body: '{"allowed":true}' }));
  await hooks.runPrePurchaseHook(ctx(), w.deps);
  const sig = w.sent[0].headers["ogawifi-signature"];
  check("during rotation the old secret still verifies",
    signing.verifySignatureHeader(sig, "whsec_old", w.sent[0].body, NOW), true);
  check("and so does the new one",
    signing.verifySignatureHeader(sig, "whsec_tenant", w.sent[0].body, NOW), true);
}
{
  const w = world(makeHook(), () => ({ status: 200, body: '{"allowed":true}' }));
  w.deps.loadHooks = async () => {
    throw new Error("Firestore unavailable");
  };
  const d = await hooks.runPrePurchaseHook(ctx(), w.deps);
  check("cannot read hook config: refuse rather than sell past a possible block", d.allowed, false);
}

/* ------------------------------------------------ account linking */

check("requireLink: true on a block is read",
  parse(200, '{"allowed":false,"requireLink":true}'),
  { kind: "block", reason: contract.DEFAULT_BLOCK_REASON, code: null, requireLink: true });
check("requireLink must be strictly true",
  (parse(200, '{"allowed":false,"requireLink":"true"}') as { requireLink?: boolean }).requireLink, false);
{
  const w = world(makeHook(), () => ({ status: 200, body: '{"allowed":true}' }), "MEMBER-0042");
  await hooks.runPrePurchaseHook(ctx(), w.deps);
  check("a linked customer's own id reaches the hook", JSON.parse(w.sent[0].body).data.customer.externalId, "MEMBER-0042");
}
{
  const w = world(makeHook(), () => ({ status: 200, body: '{"allowed":true}' }));
  w.deps.loadExternalId = async () => {
    throw new Error("Firestore unavailable");
  };
  const d = await hooks.runPrePurchaseHook(ctx(), w.deps);
  check("link read failing: the call still goes, as unlinked",
    [d.allowed, JSON.parse(w.sent[0].body).data.customer.externalId], [true, null]);
}
{
  const reply = () => ({ status: 200, body: '{"allowed":false,"reason":"Verify first","requireLink":true}' });
  const without = await hooks.runPrePurchaseHook(ctx(), world(makeHook(), reply).deps);
  check("requireLink with no verification page: just a block",
    without.allowed ? "allowed" : without.canLink, false);
  const withPage = await hooks.runPrePurchaseHook(
    ctx(), world(makeHook({ linkUrl: "https://members.tenant.example/verify" }), reply).deps);
  check("requireLink with a verification page: checkout offers to verify",
    withPage.allowed ? "allowed" : withPage.canLink, true);
}

{
  const state = "a".repeat(48);
  const t = NOW;
  const sig = signing.signLinkCallback("whsec_tenant", t, state, "MEMBER-0042");
  const ok = (p: Partial<{ t: string | null; state: string; externalId: string; sig: string | null }>, now = NOW, secrets = ["whsec_tenant"]) =>
    signing.verifyLinkCallback(secrets, { t: String(t), state, externalId: "MEMBER-0042", sig, ...p }, now);
  check("link signature verifies", ok({}), true);
  check("another external id under the same signature fails", ok({ externalId: "MEMBER-0001" }), false);
  check("another state under the same signature fails", ok({ state: "b".repeat(48) }), false);
  check("wrong secret fails", ok({}, NOW, ["whsec_other"]), false);
  check("during rotation the previous secret still verifies", ok({}, NOW, ["whsec_new", "whsec_tenant"]), true);
  check("stale callback fails", ok({}, NOW + signing.LINK_SIGNATURE_TOLERANCE_SECONDS + 1), false);
  check("future-dated callback fails", ok({}, NOW - 61), false);
  check("missing signature fails", ok({ sig: null }), false);
  check("missing time fails", ok({ t: null }), false);
  const badId = signing.signLinkCallback("whsec_tenant", t, state, "bad id<script>");
  check("an external id outside the allowed characters fails even if signed",
    signing.verifyLinkCallback(["whsec_tenant"], { t: String(t), state, externalId: "bad id<script>", sig: badId }, NOW), false);
}
{
  const now = new Date("2026-10-30T12:00:00.000Z");
  const base = { tenantId: "t1", hookId: "h1", uid: "u1", returnTo: "/", expiresAt: new Date(now.getTime() + 60_000), usedAt: null };
  check("state: valid", links.checkLinkState(base, "u1", now), null);
  check("state: missing", links.checkLinkState(null, "u1", now), "missing");
  check("state: single use", links.checkLinkState({ ...base, usedAt: now }, "u1", now), "used");
  check("state: expired", links.checkLinkState({ ...base, expiresAt: now }, "u1", now), "expired");
  check("state: someone else's state cannot link your account",
    links.checkLinkState(base, "u2", now), "wrong_user");
}
{
  const url = new URL(links.verificationUrl("https://members.tenant.example/verify?from=ogawifi", {
    state: "s1", uid: "u1", callback: "https://ogawifi.online/api/hooks/link/callback",
  }));
  check("verification URL keeps the tenant's own query", url.searchParams.get("from"), "ogawifi");
  check("and adds state, uid and callback",
    [url.searchParams.get("state"), url.searchParams.get("uid"), url.searchParams.get("callback")],
    ["s1", "u1", "https://ogawifi.online/api/hooks/link/callback"]);
}

/* ------------------------------------------------ walled garden sync */

{
  const { planWalledGardenSync, WALLED_GARDEN_HOOK_COMMENT: HOOK, WALLED_GARDEN_PORTAL_COMMENT: PORTAL } =
    await import("../lib/mikrotik");
  const existing = [
    { id: "*1", host: "ogawifi.online", comment: PORTAL },
    { id: "*2", host: "old-verify.example", comment: HOOK },
    { id: "*3", host: "tenant-own.example", comment: "front desk" },
    { id: "*4", host: "new-verify.example", comment: null },
  ];
  check("swap: the old hook host goes, the new one is added",
    planWalledGardenSync(existing, HOOK, ["new-verify.example"]), { remove: ["*2"], add: ["new-verify.example"] });
  check("an entry with the same host but not our comment is not counted as ours",
    planWalledGardenSync(existing, HOOK, ["new-verify.example"]).add, ["new-verify.example"]);
  check("clearing removes only our hook entry",
    planWalledGardenSync(existing, HOOK, []), { remove: ["*2"], add: [] });
  check("the portal's own entries and the tenant's are never touched",
    planWalledGardenSync(existing, HOOK, []).remove.some((id) => ["*1", "*3", "*4"].includes(id)), false);
  check("already right: nothing to do",
    planWalledGardenSync([{ id: "*9", host: "verify.example", comment: HOOK }], HOOK, ["verify.example"]),
    { remove: [], add: [] });
  check("duplicates of ours are cleaned up, one kept",
    planWalledGardenSync([
      { id: "*7", host: "verify.example", comment: HOOK },
      { id: "*8", host: "Verify.Example", comment: HOOK },
    ], HOOK, ["verify.example"]), { remove: ["*8"], add: [] });
}

console.log(`\n${total - failed}/${total} passed`);
process.exit(failed > 0 ? 1 : 0);
