/**
 * The fulfilment ledger: a sale interrupted at any point is finished by the
 * next caller, exactly once.
 *
 * This is the test for the bug the ledger exists to fix. Fulfilment used to
 * write the payment, then talk to the router; a process that died in
 * between left a paid customer with no voucher, and every later caller
 * reported "already done". Here the runner is stopped after every single
 * side effect in turn, then resumed, and each time the result must be
 * one voucher, one payment, one counter increment, one router user, and the
 * customer's email sent.
 *
 * Everything the runner touches is faked in memory, so this needs no
 * Firestore and no router.
 *
 * Run: npm run test:fulfilment-ledger
 */
import {
  FULFILMENT_LEASE_MS,
  nextLedgerAction,
  runFulfilment,
  type Ledger,
  type LedgerIntent,
  type RunnerDeps,
  type RunnerRouter,
} from "../lib/fulfilment-runner";

let failed = 0;
let total = 0;

function check(name: string, got: unknown, want: unknown) {
  total += 1;
  const ok = String(got) === String(want);
  if (!ok) failed += 1;
  if (!ok) {
    console.log(`FAIL  ${name}`);
    console.log(`      got: ${String(got)}   wanted: ${String(want)}`);
  }
}

const NOW = new Date("2026-10-29T12:00:00.000Z");

/* ------------------------------------------------ the decision table */

const LIVE = new Date(NOW.getTime() + 60_000);
const LAPSED = new Date(NOW.getTime() - 1);

check("started, lease live -> in_progress",
  nextLedgerAction({ state: "started", leaseUntil: LIVE, notifiedAt: null }, NOW), "in_progress");
check("started, lease lapsed -> resume",
  nextLedgerAction({ state: "started", leaseUntil: LAPSED, notifiedAt: null }, NOW), "resume");
check("complete and emailed -> done, whatever the lease",
  nextLedgerAction({ state: "complete", leaseUntil: LAPSED, notifiedAt: NOW }, NOW), "done");
check("complete, emails pending, lease live -> done (holder is sending)",
  nextLedgerAction({ state: "complete", leaseUntil: LIVE, notifiedAt: null }, NOW), "done");
check("complete, emails pending, lease lapsed -> resume (send them)",
  nextLedgerAction({ state: "complete", leaseUntil: LAPSED, notifiedAt: null }, NOW), "resume");
check("lease ending exactly now counts as lapsed",
  nextLedgerAction({ state: "started", leaseUntil: NOW, notifiedAt: null }, NOW), "resume");

/* ------------------------------------------------ the fake world */

interface World {
  ledger: Ledger;
  customerTotal: number;
  customerExists: boolean;
  routerPresent: boolean;
  routerDown: boolean;
  users: Map<string, { password: string; comment: string; patches: number }>;
  vouchers: Map<string, Record<string, unknown>>;
  superseded: string[];
  payments: Map<string, Record<string, unknown>>;
  emails: string[];
  events: number;
}

class Crash extends Error {}

/**
 * Deps over the world. Every call counts as a step; the one numbered
 * `crashAt` throws instead of running, which is a process dying there.
 * The ledger the runner holds is its own copy, as it would be in memory:
 * only `markLedger` and `applyBookkeeping` reach the stored one.
 */
function depsFor(world: World, crashAt: number | null) {
  let steps = 0;
  const step = () => {
    steps += 1;
    if (crashAt !== null && steps === crashAt) throw new Crash(`crash at ${steps}`);
  };

  const router: RunnerRouter = {
    async find(username) {
      step();
      if (world.routerDown) return { success: false, error: "router unreachable" };
      const u = world.users.get(username);
      return { success: true, data: u ? { comment: u.comment } : null };
    },
    async create(user) {
      step();
      if (world.routerDown) return { success: false, error: "router unreachable" };
      if (world.users.has(user.username)) return { success: false, error: "already exists" };
      world.users.set(user.username, { password: user.password, comment: user.comment, patches: 0 });
      return { success: true };
    },
    async revive(username, user) {
      step();
      if (world.routerDown) return { success: false, error: "router unreachable" };
      const u = world.users.get(username);
      if (!u) return { success: false, error: "not found" };
      u.password = user.password;
      u.comment = "vc";
      return { success: true };
    },
    async update(username, patch) {
      step();
      if (world.routerDown) return { success: false, error: "router unreachable" };
      const u = world.users.get(username);
      if (!u) return { success: false, error: "not found" };
      // Absolute, like RouterOS: sending the same patch twice lands the same.
      u.comment = patch.comment;
      u.patches += 1;
      return { success: true };
    },
    async resetCounters() {
      step();
      return { success: true };
    },
    async login() {
      step();
      return { success: true };
    },
  };

  const deps: RunnerDeps = {
    now: () => NOW,
    async markLedger(patch) {
      step();
      Object.assign(world.ledger, structuredClone(patch));
    },
    async applyBookkeeping() {
      step();
      // One transaction: the flag and the counter move together or not at all.
      if (world.ledger.bookkeepingApplied) return null;
      const newCustomer = !world.customerExists;
      world.customerExists = true;
      world.customerTotal += 1;
      world.ledger.bookkeepingApplied = true;
      return { newCustomer };
    },
    async checkCustomerLimit() {
      step();
    },
    async loadRouter() {
      step();
      return world.routerPresent ? router : null;
    },
    async writeVoucher(id, data) {
      step();
      world.vouchers.set(id, data);
    },
    async supersede(previousId) {
      step();
      if (!world.superseded.includes(previousId)) world.superseded.push(previousId);
    },
    async emitEvents() {
      step();
      world.events += 1;
      return true;
    },
    async createPayment(data) {
      step();
      const id = world.ledger.reference;
      if (!world.payments.has(id)) world.payments.set(id, data);
    },
    notify: {
      voucherPending: async () => { step(); world.emails.push("pending"); },
      ownerVoucherFailed: async () => { step(); world.emails.push("owner_failed"); },
      voucherReady: async () => { step(); world.emails.push("ready"); },
      voucherRenewed: async () => { step(); world.emails.push("renewed"); },
      ownerVoucherSold: async () => { step(); world.emails.push("owner_sold"); },
    },
  };

  return { deps, steps: () => steps };
}

function baseLedger(intent: LedgerIntent): Ledger {
  return {
    reference: "hs_1761739200000_abcdef12",
    tenantId: "t1",
    tenantPlanId: "starter",
    buyer: { uid: "u1", email: "buyer@example.com" },
    plan: {
      id: "p1",
      name: "Daily",
      duration: "1 day",
      dataLimit: "5GB",
      sharedUsers: "1",
      mikrotikProfile: "daily",
      routerDurationValue: 1,
      routerDurationUnit: "d",
    },
    location: { id: "l1", name: "Main", routerId: "r1" },
    deviceMac: "AA:BB:CC:DD:EE:FF",
    deviceIp: "10.5.50.10",
    payment: {
      amountKobo: 50750,
      subaccountCode: "ACCT_1",
      platformShareKobo: 5000,
      tenantShareKobo: 45000,
      hasSubaccount: true,
    },
    intent,
    state: "started",
    leaseUntil: new Date(NOW.getTime() + FULFILMENT_LEASE_MS),
    attempts: 1,
    bookkeepingApplied: false,
    router: null,
    autoLogin: false,
    activatedExpiresAt: null,
    voucherWritten: false,
    paymentWritten: false,
    notifiedAt: null,
  };
}

const MINT: LedgerIntent = { kind: "mint", voucherId: "v-new", username: "k7q2m9xp", password: "k7q2m9xp" };
const REVIVE: LedgerIntent = { kind: "revive", voucherId: "v-new", username: "ada-4821", password: "secret1" };
const EXTEND: LedgerIntent = {
  kind: "extend",
  voucherId: "v-new",
  username: "ada-4821",
  password: "secret1",
  previousVoucherId: "v-old",
  patch: { comment: "nov/05/2026 12:00:00", "limit-bytes-total": "10737418240", profile: "daily" },
  resetCounters: false,
  voucherBase: { userId: "u1", username: "ada-4821", renewalOf: "v-old" },
  expiresAt: new Date("2026-11-05T12:00:00.000Z"),
  modes: { expiry: "extend", data: "carry" },
};

function freshWorld(intent: LedgerIntent, setup?: (w: World) => void): World {
  const world: World = {
    ledger: baseLedger(intent),
    customerTotal: 0,
    customerExists: false,
    routerPresent: true,
    routerDown: false,
    users: new Map(),
    vouchers: new Map(),
    superseded: [],
    payments: new Map(),
    emails: [],
    events: 0,
  };
  setup?.(world);
  return world;
}

/**
 * Crash at step k, then resume from the stored ledger until it completes,
 * for every k up to the length of an uninterrupted run.
 */
async function crashEverywhere(
  label: string,
  intent: LedgerIntent,
  expect: { status: string; emails: string[]; users: number },
  setup?: (w: World) => void
) {
  // How many steps an uninterrupted run takes.
  const clean = freshWorld(intent, setup);
  const counter = depsFor(clean, null);
  await runFulfilment(structuredClone(clean.ledger), counter.deps, { firstAttempt: true });
  const length = counter.steps();

  for (let k = 1; k <= length + 1; k += 1) {
    const world = freshWorld(intent, setup);
    const name = `${label}, crash at step ${k}/${length}`;

    let crashed = false;
    try {
      await runFulfilment(structuredClone(world.ledger), depsFor(world, k).deps, { firstAttempt: true });
    } catch (error) {
      if (!(error instanceof Crash)) throw error;
      crashed = true;
    }

    // A resume, the way the webhook or the cron would do it after the lease
    // lapsed: a fresh copy of whatever the ledger says.
    if (crashed || !(world.ledger.state === "complete" && world.ledger.notifiedAt)) {
      await runFulfilment(structuredClone(world.ledger), depsFor(world, null).deps, { firstAttempt: false });
    }
    // And a stray extra resume must change nothing.
    const before = JSON.stringify([...world.vouchers, ...world.payments, world.customerTotal, world.emails]);
    if (nextLedgerAction(world.ledger, new Date(NOW.getTime() + FULFILMENT_LEASE_MS * 2)) === "resume") {
      await runFulfilment(structuredClone(world.ledger), depsFor(world, null).deps, { firstAttempt: false });
    }
    const after = JSON.stringify([...world.vouchers, ...world.payments, world.customerTotal, world.emails]);

    check(`${name}: ledger complete`, world.ledger.state, "complete");
    check(`${name}: emails recorded as sent`, world.ledger.notifiedAt !== null, true);
    check(`${name}: exactly one voucher`, world.vouchers.size, 1);
    check(`${name}: voucher status`, world.vouchers.get(intent.voucherId)?.status, expect.status);
    check(`${name}: exactly one payment`, world.payments.size, 1);
    check(`${name}: payment points at the voucher`, world.payments.get(world.ledger.reference)?.voucherId, intent.voucherId);
    check(`${name}: counters incremented once`, world.customerTotal, 1);
    check(`${name}: router users`, world.users.size, expect.users);
    for (const email of expect.emails) {
      const sent = world.emails.filter((e) => e === email).length;
      // At least once, and at most twice: a crash between sending and
      // recording costs a duplicate, never a missing email.
      check(`${name}: ${email} email sent`, sent >= 1 && sent <= 2, true);
    }
    check(`${name}: no wrong emails`, world.emails.every((e) => expect.emails.includes(e)), true);
    // At least once, like the emails; the event id makes repeats harmless.
    check(`${name}: webhook events recorded`, world.events >= 1 && world.ledger.eventsEmitted === true, true);
    check(`${name}: extra resume is a no-op`, after, before);

    if (intent.kind === "extend" && expect.status === "active") {
      const user = world.users.get(intent.username)!;
      check(`${name}: router comment is the planned one, not extended twice`, user.comment, intent.patch.comment);
      check(`${name}: previous voucher superseded once`, world.superseded.join(","), "v-old");
    }
  }
}

await crashEverywhere("mint", MINT, { status: "active", emails: ["ready", "owner_sold"], users: 1 });

await crashEverywhere("revive", REVIVE, { status: "active", emails: ["ready", "owner_sold"], users: 1 }, (w) => {
  w.users.set("ada-4821", { password: "secret1", comment: "oct/20/2026 09:00:00", patches: 0 });
});

await crashEverywhere("extend", EXTEND, { status: "active", emails: ["renewed", "owner_sold"], users: 1 }, (w) => {
  w.users.set("ada-4821", { password: "secret1", comment: "oct/30/2026 12:00:00", patches: 0 });
  w.customerExists = true;
  w.customerTotal = 0;
});

await crashEverywhere("router down", MINT, { status: "failed", emails: ["pending", "owner_failed"], users: 0 }, (w) => {
  w.routerDown = true;
});

await crashEverywhere("router document gone", MINT, { status: "failed", emails: ["pending", "owner_failed"], users: 0 }, (w) => {
  w.routerPresent = false;
});

/* ------------------------------------------------ specific behaviour */

{
  // A resume must never mint over a name somebody else owns on the router.
  const world = freshWorld(MINT, (w) => {
    w.users.set("k7q2m9xp", { password: "tenant-own", comment: "front desk laptop", patches: 0 });
  });
  await runFulfilment(structuredClone(world.ledger), depsFor(world, null).deps, { firstAttempt: false });
  check("resume onto a hand-made user: voucher failed, not overwritten", world.vouchers.get("v-new")?.status, "failed");
  check("resume onto a hand-made user: their password untouched", world.users.get("k7q2m9xp")?.password, "tenant-own");
}

{
  // Auto-login is a first-attempt thing: a resume does not log a device in,
  // so it records no activation expiry either.
  const world = freshWorld(MINT);
  await runFulfilment(structuredClone(world.ledger), depsFor(world, null).deps, { firstAttempt: false });
  check("resume does not auto-login", world.ledger.autoLogin, false);
  check("resume leaves expiry to the router-health cron", world.vouchers.get("v-new")?.expiresAt, null);

  const first = freshWorld(MINT);
  await runFulfilment(structuredClone(first.ledger), depsFor(first, null).deps, { firstAttempt: true });
  check("first attempt auto-logs-in", first.ledger.autoLogin, true);
  check("first attempt records the activation expiry",
    (first.vouchers.get("v-new")?.expiresAt as Date | null)?.toISOString(), "2026-10-30T12:00:00.000Z");
}

{
  // An owner who retried a failed voucher from the Failed Queue before the
  // resume ran must not have it put back to "failed".
  // The sale ends in a failed voucher with its emails still unsent, the
  // owner fixes the voucher, and only then does a resume arrive.
  const world = freshWorld(MINT, (w) => { w.routerDown = true; });
  await runFulfilment(structuredClone(world.ledger), depsFor(world, null).deps, { firstAttempt: true });
  world.vouchers.get("v-new")!.status = "active"; // the owner's retry
  world.ledger.notifiedAt = null;
  world.ledger.leaseUntil = LAPSED;
  await runFulfilment(structuredClone(world.ledger), depsFor(world, null).deps, { firstAttempt: false });
  check("resume leaves a retried voucher alone", world.vouchers.get("v-new")?.status, "active");
}

{
  // Webhooks failing must never fail a sale, or hold up its emails.
  const world = freshWorld(MINT);
  const { deps } = depsFor(world, null);
  deps.emitEvents = async () => false;
  await runFulfilment(structuredClone(world.ledger), deps, { firstAttempt: true });
  check("events failing: the sale still completes", world.ledger.state, "complete");
  check("events failing: the customer is still emailed", world.emails.includes("ready"), true);
  check("events failing: left unflagged, so a resume tries again", world.ledger.eventsEmitted === true, false);
}

console.log(`\n${total - failed}/${total} passed`);
if (failed > 0) process.exit(1);
