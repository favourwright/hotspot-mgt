/**
 * The arithmetic of tenant voucher generation, with no Firestore and no
 * router: which billing cycle a moment falls in, how a request is paid for
 * out of the plan's allowance and the tenant's credits, and what a code
 * looks like. `npm run test:voucher-generation` covers all of it.
 *
 * The server half is lib/voucher-generation.ts. The why is in
 * docs/voucher-generation.md.
 */

import { randomInt } from "crypto";

import type { GeneratedCodeFormat } from "@/types/schemas";
import { CODE_ALPHABETS } from "@/lib/generated-code-alphabets";

export { CODE_ALPHABETS, codeSpaceBits } from "@/lib/generated-code-alphabets";

/* ------------------------------------------------------------------ codes */

export const DEFAULT_CODE_FORMAT: GeneratedCodeFormat = {
  length: 8,
  charset: "alnum",
  prefix: "",
  passwordMode: "same",
};

/** Uniform over the alphabet: `randomInt` rejects rather than taking a modulo. */
function randomString(alphabet: string, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

export interface GeneratedCredential {
  username: string;
  password: string;
}

export function generateCredential(format: GeneratedCodeFormat): GeneratedCredential {
  const alphabet = CODE_ALPHABETS[format.charset];
  const code = randomString(alphabet, format.length);
  return {
    username: `${format.prefix}${code}`,
    password: format.passwordMode === "same" ? code : randomString(alphabet, format.length),
  };
}

/**
 * `count` credentials, none sharing a username with each other or with
 * anything in `taken` (the router's unused codes, say). A clash at these
 * sizes is vanishingly rare, so this only bounds the retry rather than
 * reasoning about it, and throws rather than return fewer than asked.
 */
export function generateCredentials(
  format: GeneratedCodeFormat,
  count: number,
  taken: ReadonlySet<string> = new Set()
): GeneratedCredential[] {
  const seen = new Set<string>();
  const out: GeneratedCredential[] = [];
  let attempts = 0;
  while (out.length < count) {
    if (++attempts > count * 20 + 100) {
      throw new Error("Could not generate enough distinct codes; try a longer code length");
    }
    const credential = generateCredential(format);
    if (seen.has(credential.username) || taken.has(credential.username)) continue;
    seen.add(credential.username);
    out.push(credential);
  }
  return out;
}


/* ------------------------------------------------------------ the cycle */

export interface CycleInput {
  /** When the tenant's next plan fee falls due. Null on free and comped plans. */
  nextBillingDate: Date | null;
  billingInterval: "monthly" | "yearly";
  /** The fallback anchor when there is no billing date. */
  tenantCreatedAt: Date;
}

export interface GenerationCycle {
  start: Date;
  end: Date;
  /** Stable id for this cycle's usage document. */
  key: string;
}

function daysInMonthUtc(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * The anchor moved by whole months, clamping the day: an anchor on the 31st
 * lands on the 30th in April and the 28th or 29th in February, and is back
 * on the 31st in May. Computed from the anchor every time rather than by
 * stepping, so the clamp never accumulates.
 */
export function addMonthsUtc(anchor: Date, months: number): Date {
  const total = anchor.getUTCFullYear() * 12 + anchor.getUTCMonth() + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12;
  const day = Math.min(anchor.getUTCDate(), daysInMonthUtc(year, month));
  return new Date(
    Date.UTC(
      year,
      month,
      day,
      anchor.getUTCHours(),
      anchor.getUTCMinutes(),
      anchor.getUTCSeconds(),
      anchor.getUTCMilliseconds()
    )
  );
}

/**
 * The billing cycle `now` falls in.
 *
 * Anchored on `nextBillingDate` when there is one, so the allowance resets
 * on the day the tenant is charged. A tenant with no subscription (a free
 * or usage-only plan, or comped) has no billing date, and their cycle is
 * anchored on the day the tenant was created instead, at the plan's
 * interval. A billing date in the past (a lapsed subscription) still works:
 * cycles are counted back or forward from the anchor in whole intervals.
 *
 * When a renewal moves `nextBillingDate` on by one interval the boundaries
 * do not move, because the new anchor is one of the old cycle boundaries.
 */
export function generationCycle(now: Date, input: CycleInput): GenerationCycle {
  const anchor = input.nextBillingDate ?? input.tenantCreatedAt;
  const step = input.billingInterval === "yearly" ? 12 : 1;

  const monthsApart =
    (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - anchor.getUTCMonth());
  let k = Math.floor(monthsApart / step) * step;
  while (addMonthsUtc(anchor, k).getTime() > now.getTime()) k -= step;
  while (addMonthsUtc(anchor, k + step).getTime() <= now.getTime()) k += step;

  const start = addMonthsUtc(anchor, k);
  const end = addMonthsUtc(anchor, k + step);
  return { start, end, key: start.toISOString().replace(/[:.]/g, "-") };
}

/* ------------------------------------------------------------ the quota */

export interface QuotaState {
  /** Codes the plan includes per cycle; null is unlimited. */
  allowance: number | null;
  /** Drawn from the allowance so far this cycle. */
  usedThisCycle: number;
  /** Top-up credits on hand. They never expire. */
  credits: number;
}

export interface Reservation {
  fromAllowance: number;
  fromCredits: number;
}

/** What the tenant could generate right now; null when unlimited. */
export function availableToGenerate(state: QuotaState): number | null {
  if (state.allowance === null) return null;
  return Math.max(0, state.allowance - state.usedThisCycle) + Math.max(0, state.credits);
}

/**
 * Pays for `count` codes: the cycle's allowance first, because it is lost
 * at the end of the cycle, then credits, which are not. Null when the two
 * together cannot cover it; nothing is ever partly granted.
 */
export function reserveQuota(state: QuotaState, count: number): Reservation | null {
  if (!Number.isInteger(count) || count <= 0) return null;
  if (state.allowance === null) return { fromAllowance: count, fromCredits: 0 };

  const leftInCycle = Math.max(0, state.allowance - state.usedThisCycle);
  const fromAllowance = Math.min(count, leftInCycle);
  const fromCredits = count - fromAllowance;
  if (fromCredits > Math.max(0, state.credits)) return null;
  return { fromAllowance, fromCredits };
}

/**
 * Gives back what `failed` codes cost, in reverse order of drawing: credits
 * first, since they were drawn last and are the ones a tenant paid for.
 * Allowance goes back to the cycle it was drawn from, which may have ended.
 */
export function releaseQuota(reservation: Reservation, failed: number): Reservation {
  const n = Math.max(0, Math.min(failed, reservation.fromAllowance + reservation.fromCredits));
  const credits = Math.min(n, reservation.fromCredits);
  return { fromCredits: credits, fromAllowance: n - credits };
}

/**
 * The most credits one online purchase may buy, so a typed extra zero is a
 * refused request rather than a large charge. This module imports `crypto`,
 * so the page hands it to the form as a prop rather than the form importing it.
 */
export const MAX_CREDIT_PURCHASE = 10_000;

/**
 * Whether `count` more codes fit on a router already holding `onRouter`
 * unused ones, counting codes still being put there. The limit is
 * `PlatformConfig.voucherGeneration.maxUnusedPerRouter`.
 */
export function routerHasRoom(onRouter: number, count: number, max: number): boolean {
  return onRouter + count <= max;
}
