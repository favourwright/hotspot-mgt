/**
 * Voucher generation: the cycle, the quota, the codes, and the batch runner.
 *
 * The runner half follows test-fulfilment-ledger: a fake router and a fake
 * store, a crash injected after every side effect in turn, and a resume
 * that has to end with every code on the router once, in the index once,
 * and the quota for failures given back exactly once.
 *
 * Run: npm run test:voucher-generation
 */
import {
  addMonthsUtc,
  availableToGenerate,
  codeSpaceBits,
  CODE_ALPHABETS,
  generateCredentials,
  generationCycle,
  releaseQuota,
  reserveQuota,
} from "../lib/voucher-generation-rules";
import {
  MAX_BATCH_ATTEMPTS,
  findActivations,
  generatedVoucherId,
  isOurs,
  runBatch,
  type BatchCode,
  type BatchRouter,
  type VoucherBatch,
} from "../lib/voucher-batch-runner";

let failed = 0;
let total = 0;

function check(name: string, got: unknown, want: unknown) {
  total += 1;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(70)} ${JSON.stringify(got)}`);
  if (!ok) console.log(`      wanted: ${JSON.stringify(want)}`);
}

const iso = (d: Date) => d.toISOString();

/* ------------------------------------------------------------- cycles */
console.log("\n-- billing cycle");
{
  const monthly = (next: string | null, now: string, created = "2026-01-10T09:00:00.000Z") =>
    generationCycle(new Date(now), {
      nextBillingDate: next ? new Date(next) : null,
      billingInterval: "monthly",
      tenantCreatedAt: new Date(created),
    });

  let c = monthly("2026-11-20T08:00:00.000Z", "2026-11-05T12:00:00.000Z");
  check("monthly: before the billing date", [iso(c.start), iso(c.end)], [
    "2026-10-20T08:00:00.000Z",
    "2026-11-20T08:00:00.000Z",
  ]);
  c = monthly("2026-11-20T08:00:00.000Z", "2026-11-20T08:00:00.000Z");
  check("monthly: exactly on the billing moment starts the new cycle", iso(c.start), "2026-11-20T08:00:00.000Z");
  c = monthly("2026-08-20T08:00:00.000Z", "2026-11-05T12:00:00.000Z");
  check("monthly: lapsed billing date still counts forward", iso(c.start), "2026-10-20T08:00:00.000Z");

  const before = monthly("2026-11-20T08:00:00.000Z", "2026-11-25T00:00:00.000Z");
  const after = monthly("2026-12-20T08:00:00.000Z", "2026-11-25T00:00:00.000Z");
  check("renewal moving the billing date on does not move the cycle", after.key, before.key);

  c = monthly(null, "2026-11-05T12:00:00.000Z");
  check("no billing date: anchored on tenant creation", [iso(c.start), iso(c.end)], [
    "2026-10-10T09:00:00.000Z",
    "2026-11-10T09:00:00.000Z",
  ]);

  check("31st clamps to 30 April", iso(addMonthsUtc(new Date("2026-01-31T00:00:00Z"), 3)), "2026-04-30T00:00:00.000Z");
  check("31st clamps to 28 Feb", iso(addMonthsUtc(new Date("2026-01-31T00:00:00Z"), 1)), "2026-02-28T00:00:00.000Z");
  check("and is back on the 31st in May", iso(addMonthsUtc(new Date("2026-01-31T00:00:00Z"), 4)), "2026-05-31T00:00:00.000Z");
  c = monthly("2026-01-31T00:00:00.000Z", "2026-03-15T00:00:00.000Z");
  check("anchor on the 31st: Feb 28 to Mar 31", [iso(c.start), iso(c.end)], [
    "2026-02-28T00:00:00.000Z",
    "2026-03-31T00:00:00.000Z",
  ]);

  const yearly = generationCycle(new Date("2026-11-05T00:00:00Z"), {
    nextBillingDate: new Date("2027-03-01T00:00:00Z"),
    billingInterval: "yearly",
    tenantCreatedAt: new Date("2025-03-01T00:00:00Z"),
  });
  check("yearly plan: a year-long cycle", [iso(yearly.start), iso(yearly.end)], [
    "2026-03-01T00:00:00.000Z",
    "2027-03-01T00:00:00.000Z",
  ]);
  check("cycle key has no characters a document id dislikes", /^[0-9A-Za-z-]+$/.test(c.key), true);
}

/* -------------------------------------------------------------- quota */
console.log("\n-- quota");
check("allowance first", reserveQuota({ allowance: 100, usedThisCycle: 90, credits: 50 }, 30), {
  fromAllowance: 10,
  fromCredits: 20,
});
check("credits only when allowance is spent", reserveQuota({ allowance: 100, usedThisCycle: 100, credits: 5 }, 5), {
  fromAllowance: 0,
  fromCredits: 5,
});
check("zero allowance plan uses credits", reserveQuota({ allowance: 0, usedThisCycle: 0, credits: 3 }, 3), {
  fromAllowance: 0,
  fromCredits: 3,
});
check("refused rather than partly granted", reserveQuota({ allowance: 10, usedThisCycle: 5, credits: 2 }, 8), null);
check("unlimited never touches credits", reserveQuota({ allowance: null, usedThisCycle: 9999, credits: 4 }, 50), {
  fromAllowance: 50,
  fromCredits: 0,
});
check("over-used allowance (plan downgraded) is not negative", reserveQuota({ allowance: 10, usedThisCycle: 40, credits: 1 }, 1), {
  fromAllowance: 0,
  fromCredits: 1,
});
check("zero or fractional counts refused", [reserveQuota({ allowance: null, usedThisCycle: 0, credits: 0 }, 0), reserveQuota({ allowance: null, usedThisCycle: 0, credits: 0 }, 1.5)], [null, null]);
check("available", availableToGenerate({ allowance: 100, usedThisCycle: 120, credits: 7 }), 7);
check("release gives credits back first", releaseQuota({ fromAllowance: 10, fromCredits: 20 }, 25), {
  fromCredits: 20,
  fromAllowance: 5,
});
check("release never exceeds what was drawn", releaseQuota({ fromAllowance: 3, fromCredits: 0 }, 10), {
  fromCredits: 0,
  fromAllowance: 3,
});

/* -------------------------------------------------------------- codes */
console.log("\n-- codes");
{
  const fmt = { length: 8, charset: "alnum" as const, prefix: "OG", passwordMode: "same" as const };
  const creds = generateCredentials(fmt, 500, new Set(["OGAAAAAAAA"]));
  check("500 distinct usernames", new Set(creds.map((c) => c.username)).size, 500);
  check("prefix + length", creds.every((c) => c.username.startsWith("OG") && c.username.length === 10), true);
  check("same-password mode: password is the code without the prefix", creds.every((c) => c.password === c.username.slice(2)), true);
  check(
    "no ambiguous characters",
    creds.every((c) => [...c.username.slice(2)].every((ch) => CODE_ALPHABETS.alnum.includes(ch) && !"01OIL".includes(ch))),
    true
  );
  const sep = generateCredentials({ ...fmt, prefix: "", passwordMode: "separate" }, 50);
  check("separate mode: passwords differ from usernames", sep.every((c) => c.password !== c.username), true);
  const digits = generateCredentials({ length: 10, charset: "digits", prefix: "", passwordMode: "same" }, 20);
  check("digit codes are digits", digits.every((c) => /^\d{10}$/.test(c.username)), true);
  check("8 alnum is about 39.6 bits", Math.round(codeSpaceBits(fmt) * 10) / 10, 39.6);
  let threw = false;
  try {
    generateCredentials({ length: 8, charset: "digits", prefix: "", passwordMode: "same" }, 10, new Set());
  } catch {
    threw = true;
  }
  check("a small space still generates when there is room", threw, false);
}

/* ------------------------------------------------------------- runner */
console.log("\n-- runner");

interface RouterUser {
  password: string;
  comment: string;
  profile: string;
}

class FakeRouter implements BatchRouter {
  users = new Map<string, RouterUser>();
  down = false;
  /** Create lands on the router but the answer is lost. */
  loseNextAnswer = false;
  refuse = new Set<string>();
  creates = 0;

  async find(username: string) {
    if (this.down) return { success: false, error: "timeout" };
    const u = this.users.get(username);
    return { success: true, data: u ? { comment: u.comment, password: u.password } : null };
  }
  async create(user: { username: string; password: string; profile: string; comment: string }) {
    if (this.down) return { success: false, error: "timeout" };
    if (this.refuse.has(user.username)) return { success: false, error: "input does not match any value of profile" };
    if (this.users.has(user.username)) return { success: false, error: "failure: already have user with this name" };
    this.users.set(user.username, { password: user.password, comment: user.comment, profile: user.profile });
    this.creates++;
    if (this.loseNextAnswer) {
      this.loseNextAnswer = false;
      return { success: false, error: "timeout" };
    }
    return { success: true };
  }
}

class Crash extends Error {}

interface Store {
  codes: BatchCode[];
  index: Set<string>;
  released: boolean;
  releasedCount: number[];
  state: VoucherBatch["state"];
  attempts: number;
}

let renameSeq = 0;

function makeBatch(n: number): { batch: VoucherBatch; store: Store } {
  const codes: BatchCode[] = Array.from({ length: n }, (_, i) => ({
    username: `CODE${String(i).padStart(4, "0")}`,
    password: `PW${i}`,
    status: "pending",
    error: null,
    voucherId: null,
    activatedAt: null,
    voidedAt: null,
  }));
  const batch: VoucherBatch = {
    id: "b1",
    tenantId: "t1",
    locationId: "l1",
    locationName: "Main",
    routerId: "r1",
    plan: {
      id: "p1",
      name: "Daily",
      duration: "1 day",
      dataLimit: null,
      sharedUsers: null,
      mikrotikProfile: "daily",
      routerDurationValue: 1,
      routerDurationUnit: "d",
    },
    count: n,
    codes,
    state: "minting",
    leaseUntil: null,
    attempts: 0,
    reservation: { fromAllowance: n, fromCredits: 0, cycleKey: "k" },
    released: false,
    createdBy: { uid: "u", email: null },
    createdAt: new Date(0),
    finishedAt: null,
  };
  return {
    batch,
    store: { codes: codes.map((c) => ({ ...c })), index: new Set(), released: false, releasedCount: [], state: "minting", attempts: 0 },
  };
}

/** One run against the store, crashing after the `crashAt`-th side effect. */
async function runOnce(batch: VoucherBatch, store: Store, router: FakeRouter, crashAt = Infinity) {
  let effects = 0;
  const tick = () => {
    if (++effects >= crashAt) throw new Crash();
  };
  store.attempts++;
  const wrapped: BatchRouter = {
    find: (u) => router.find(u),
    create: async (u) => {
      const r = await router.create(u);
      tick();
      return r;
    },
  };
  return runBatch(
    { ...batch, codes: store.codes.map((c) => ({ ...c })), attempts: store.attempts, released: store.released },
    {
      now: () => new Date(1000),
      loadRouter: async () => wrapped,
      indexUnused: async (names) => {
        for (const n of names) store.index.add(n);
        tick();
      },
      saveProgress: async (codes, patch) => {
        store.codes = codes.map((c) => ({ ...c }));
        if (patch.state) store.state = patch.state;
        tick();
      },
      release: async (n) => {
        if (store.released) return;
        store.released = true;
        store.releasedCount.push(n);
        tick();
      },
      regenerate: () => ({ username: `RENAMED${++renameSeq}`, password: `RPW${renameSeq}` }),
    }
  );
}

async function runToCompletion(batch: VoucherBatch, store: Store, router: FakeRouter, crashAt: number) {
  try {
    await runOnce(batch, store, router, crashAt);
  } catch (e) {
    if (!(e instanceof Crash)) throw e;
  }
  for (let i = 0; i < 10 && (store.state === "minting" || !store.released); i++) {
    await runOnce(batch, store, router);
  }
}

function invariant(store: Store, router: FakeRouter, n: number) {
  const unused = store.codes.filter((c) => c.status === "unused");
  return {
    allUnused: unused.length === n,
    onRouterOnce: router.users.size === n && unused.every((c) => router.users.get(c.username)?.password === c.password),
    indexed: unused.every((c) => store.index.has(c.username)) && store.index.size === n,
    releasedOnce: store.releasedCount.length === 1 && store.releasedCount[0] === 0,
    state: store.state,
  };
}

{
  const N = 23; // not a multiple of the chunk size
  const ok = { allUnused: true, onRouterOnce: true, indexed: true, releasedOnce: true, state: "ready" };

  const { batch, store } = makeBatch(N);
  const router = new FakeRouter();
  await runToCompletion(batch, store, router, Infinity);
  check("clean run", invariant(store, router, N), ok);

  // Count the side effects of a clean run, then crash after each in turn.
  let effects = 0;
  {
    const { batch: b, store: s } = makeBatch(N);
    const r = new FakeRouter();
    const counting = new Proxy(r, {});
    await runOnce(b, s, counting as FakeRouter, Infinity);
    effects = r.creates + 3 /* index */ + 4 /* progress */ + 1 /* final save */ + 1 /* release */;
  }
  let allResumed = true;
  for (let crashAt = 1; crashAt <= effects; crashAt++) {
    const { batch: b, store: s } = makeBatch(N);
    const r = new FakeRouter();
    await runToCompletion(b, s, r, crashAt);
    const inv = invariant(s, r, N);
    if (JSON.stringify(inv) !== JSON.stringify(ok)) {
      allResumed = false;
      console.log(`      crash after effect ${crashAt}:`, inv);
    }
  }
  check(`crash after each of ${effects} side effects, then resume`, allResumed, true);
}

{
  const { batch, store } = makeBatch(5);
  const router = new FakeRouter();
  router.users.set("CODE0002", { password: "someone-else", comment: "vc", profile: "x" });
  await runToCompletion(batch, store, router, Infinity);
  const renamed = store.codes[2];
  check("a name taken by somebody else is renamed", renamed.username.startsWith("RENAMED") && renamed.status === "unused", true);
  check("and the other user is untouched", router.users.get("CODE0002")?.password, "someone-else");
  check("all five end up unused", store.codes.filter((c) => c.status === "unused").length, 5);
}

{
  const { batch, store } = makeBatch(3);
  const router = new FakeRouter();
  router.loseNextAnswer = true;
  await runToCompletion(batch, store, router, Infinity);
  check("a create whose answer was lost is recognised as ours", store.codes[0].status, "unused");
  check("and not created twice or renamed", [router.users.size, store.codes[0].username], [3, "CODE0000"]);
}

{
  const { batch, store } = makeBatch(4);
  const router = new FakeRouter();
  router.refuse.add("CODE0001");
  await runToCompletion(batch, store, router, Infinity);
  check("a refused code fails; the rest go on", store.codes.map((c) => c.status), ["unused", "failed", "unused", "unused"]);
  check("partial batch", store.state, "partial");
  check("its quota is given back once", store.releasedCount, [1]);
  check("a failed code is not indexed", store.index.has("CODE0001"), false);
}

{
  const { batch, store } = makeBatch(15);
  const router = new FakeRouter();
  // Down after the first chunk lands.
  const orig = router.create.bind(router);
  router.create = async (u) => {
    const r = await orig(u);
    if (router.creates === 10) router.down = true;
    return r;
  };
  const first = await runOnce(batch, store, router);
  check("router going down interrupts rather than failing codes", [first.interrupted, store.state, store.codes.filter((c) => c.status === "failed").length], [true, "minting", 0]);
  check("nothing released while interrupted", store.releasedCount, []);
  router.down = false;
  await runOnce(batch, store, router);
  check("resume when it is back finishes the batch", invariant(store, router, 15), {
    allUnused: true,
    onRouterOnce: true,
    indexed: true,
    releasedOnce: true,
    state: "ready",
  });
}

{
  const { batch, store } = makeBatch(4);
  const router = new FakeRouter();
  router.down = true;
  for (let i = 0; i < MAX_BATCH_ATTEMPTS; i++) await runOnce(batch, store, router);
  check(`after ${MAX_BATCH_ATTEMPTS} attempts the rest is given up on`, [store.state, store.releasedCount], ["failed", [4]]);
}

{
  const { batch, store } = makeBatch(3);
  await runBatch(
    { ...batch, attempts: 1 },
    {
      now: () => new Date(0),
      loadRouter: async () => null,
      indexUnused: async () => {},
      saveProgress: async (codes, patch) => {
        store.codes = codes;
        if (patch.state) store.state = patch.state;
      },
      release: async (n) => {
        store.releasedCount.push(n);
      },
      regenerate: () => ({ username: "X", password: "Y" }),
    }
  );
  check("router document gone: every code fails, all quota back", [store.state, store.releasedCount], ["failed", [3]]);
}

console.log("\n-- ownership and activation");
check("password match is ours", isOurs({ password: "a", comment: "2026-11-01 10:00:00" }, { password: "a" }), true);
check("password mismatch is not, whatever the comment", isOurs({ password: "b", comment: "vc" }, { password: "a" }), false);
check("no password returned: vc marker is the fallback", isOurs({ comment: "vc" }, { password: "a" }), true);
check("no password, no marker: not ours", isOurs({ comment: "made in winbox" }, { password: "a" }), false);

const parse = (c: string | undefined) => (c && /^\d{4}-/.test(c) ? new Date(c.replace(" ", "T") + "Z") : null);
check(
  "activation: only indexed codes whose comment became a date",
  findActivations(
    { AAA: "b1", BBB: "b1", CCC: "b2" },
    [
      { name: "AAA", comment: "2026-11-06 10:00:00" },
      { name: "BBB", comment: "vc" },
      { name: "DDD", comment: "2026-11-06 10:00:00" },
      { name: "CCC", comment: "2026-11-07 09:00:00" },
    ],
    parse
  ).map((a) => `${a.username}@${a.batchId}`),
  ["AAA@b1", "CCC@b2"]
);
check("voucher id is deterministic per code", generatedVoucherId("b1", "AAA"), "gen-b1-AAA");

console.log(`\n${total - failed}/${total} passed`);
if (failed > 0) process.exit(1);
