/**
 * Deciding what a repeat purchase should actually do.
 *
 * Before this app existed, the tenant ran vouchers by hand: one router user
 * per customer, and a new subscription meant editing that user's validity
 * rather than creating another one. Automating it reversed that - every
 * purchase minted a fresh random credential and a fresh RouterOS user, and
 * nothing ever removed the old one, so the hotspot user list grew by one per
 * sale forever and most of it was expired.
 *
 * This module puts the old behaviour back where it is correct, and only
 * where it is correct. Two facts about the router decide the whole thing:
 *
 *  1. **Expiry is wall-clock from first login, not from purchase.** The
 *     profile's on-login script stamps `now + duration` into the user's
 *     comment the first time they connect (lib/mikrotik.ts). So a customer
 *     renewing early genuinely has unused days left, and minting a fresh
 *     voucher throws them away.
 *  2. **A RouterOS user has exactly one profile, and the profile is what
 *     carries speed and duration.** Two plans cannot share one credential.
 *     This is not a policy choice, it is the router.
 *
 * Which gives three cases, in `resolveVoucherAction` below.
 *
 * Everything here is pure. The Firestore and router work lives in
 * lib/voucher-fulfilment.ts, and the arithmetic lives here so
 * `npm run test:voucher-renewal` can cover the parts that are easy to get
 * subtly wrong - carrying remaining days over, and carrying remaining data
 * over without ever turning an uncapped plan into a capped one.
 */

import { parseDataLimitBytes } from "@/lib/mikrotik";
import type { Plan, Voucher } from "@/types/schemas";

/**
 * What the buyer said this purchase is for.
 *
 * This exists because guessing was wrong. The first version worked it out
 * from their history alone, and on the day it shipped a customer bought the
 * same daily plan three times in nineteen minutes, meaning to hand two of
 * the codes to other people. All three stacked onto his own login and he
 * ended up with one code carrying three days.
 *
 * No amount of looking at the history could have told those two intentions
 * apart, because they are identical from the outside. So the buyer is asked
 * (see `components/shared/purchase-intent-choice.tsx`) and the answer rides
 * on the Paystack charge's own metadata, which is what lets the webhook and
 * the reconciliation cron fulfil the sale the same way the browser would
 * have.
 *
 * Absent means `"reuse"`, which is the behaviour that shipped, so an old
 * reference or a caller that does not send one is unaffected.
 */
export type PurchaseIntent = "reuse" | "fresh";

export const DEFAULT_PURCHASE_INTENT: PurchaseIntent = "reuse";

export function parsePurchaseIntent(value: unknown): PurchaseIntent {
  return value === "fresh" ? "fresh" : DEFAULT_PURCHASE_INTENT;
}

/**
 * The tenant's house rules for what renewing means, from their own
 * settings (`Tenant.renewalExpiryMode` / `renewalDataMode`).
 *
 * Passed in rather than read here because everything in this module is
 * pure, and because the preview the buyer is shown and the renewal that
 * actually runs have to be computed from the same two values. The defaults
 * are the behaviour that shipped, so a caller that does not know about
 * modes is unaffected.
 */
export type RenewalExpiryMode = "extend" | "reset";
export type RenewalDataMode = "carry" | "reset";

export interface RenewalModes {
  expiry: RenewalExpiryMode;
  data: RenewalDataMode;
}

export const DEFAULT_RENEWAL_MODES: RenewalModes = {
  expiry: "extend",
  data: "carry",
};

/**
 * Reads the two modes off a tenant record, from anywhere.
 *
 * Takes a loose object rather than a parsed `Tenant` because the money path
 * works with the raw Firestore data and never pays for a schema parse, and
 * because an unrecognised or missing value has exactly one safe answer:
 * the behaviour that shipped.
 */
export function parseRenewalModes(
  tenant: { renewalExpiryMode?: unknown; renewalDataMode?: unknown } | null | undefined
): RenewalModes {
  return {
    expiry: tenant?.renewalExpiryMode === "reset" ? "reset" : "extend",
    data: tenant?.renewalDataMode === "reset" ? "reset" : "carry",
  };
}

export type VoucherAction =
  /** A brand new random code, touching nothing the buyer already holds. */
  | { kind: "fresh" }
  /**
   * Same plan, same location, already activated and still running. Push the
   * expiry out and top the data up on the credential they already know.
   */
  | { kind: "extend"; voucher: Voucher }
  /**
   * Put this purchase on a login the buyer already has but is not using: a
   * dead voucher's code, or the one they chose on their profile page.
   *
   * Nothing carries over. The old plan is finished, so `reviveHotspotUser`
   * resets the byte counters and applies the new plan's allowance from
   * zero. What is reused is the *name*, which is the whole value of it -
   * they do not have to learn a new code, and the router does not gain
   * another dead user.
   *
   * `previous` is the voucher whose code this is, or null when the code
   * comes from their saved profile credential and has never been issued.
   */
  | { kind: "revive"; username: string; previous: Voucher | null }
  /**
   * Same plan, same location, bought and never used. There is nothing to
   * extend - the clock has not started, and the on-login script knows only
   * one duration per profile, so two unactivated purchases cannot stack.
   *
   * Only ever reached under `"reuse"`. A buyer who says the voucher is for
   * somebody else is not blocked by holding an unused one of their own:
   * that is a different person's code and a perfectly ordinary sale, and
   * refusing it was the second half of the same mistake.
   *
   * Used to refuse the sale **before** Paystack opens. It is never acted on
   * after a payment: see the note in lib/voucher-fulfilment.ts.
   */
  | { kind: "unactivated"; voucher: Voucher };

/**
 * Picks the action for a purchase, given the buyer's answer and everything
 * they have ever bought from this tenant.
 *
 * `"fresh"` short-circuits everything: a code for somebody else must not
 * touch the buyer's own plan, their saved login, or anything else they
 * hold. Every other branch below is the `"reuse"` path.
 *
 * Under `"reuse"`, scoped to plan **and** location, in order:
 *
 *  1. a running voucher for this same plan  -> extend it
 *  2. an unused voucher for this same plan  -> nothing to extend, refuse
 *  3. a login of theirs sitting idle        -> put the new plan on it
 *  4. otherwise                             -> a new code
 *
 * Step 3 is deliberately not restricted to the same plan. The login is dead
 * either way, so a customer moving from Daily to Weekly keeps the code they
 * know rather than learning a new one, and the router stops collecting a
 * fresh user per sale.
 */
export function resolveVoucherAction(
  vouchers: Voucher[],
  context: {
    planId: string;
    locationId: string;
    now: Date;
    intent?: PurchaseIntent;
    /**
     * The login from the buyer's profile page, if they set one. Preferred
     * over any past voucher's code at step 3, because it is the one they
     * actually chose and expect to be given.
     */
    savedUsername?: string | null;
  }
): VoucherAction {
  const intent = context.intent ?? DEFAULT_PURCHASE_INTENT;
  if (intent === "fresh") return { kind: "fresh" };

  const atLocation = vouchers.filter(
    (voucher) => voucher.locationId === context.locationId && !voucher.archivedAt
  );

  const samePlan = atLocation.filter(
    (voucher) => voucher.planId === context.planId && voucher.status === "active"
  );

  // The one running furthest into the future, so a customer who somehow
  // holds two gets the longer one extended rather than the older one.
  const activated = samePlan
    .filter(
      (voucher) =>
        voucher.expiresAt !== null &&
        voucher.expiresAt.getTime() > context.now.getTime()
    )
    .sort((a, b) => b.expiresAt!.getTime() - a.expiresAt!.getTime())[0];

  if (activated) return { kind: "extend", voucher: activated };

  const unactivated = samePlan.find((voucher) => voucher.expiresAt === null);
  if (unactivated) return { kind: "unactivated", voucher: unactivated };

  // Any login of theirs that something else is not already using. A live
  // voucher's code is off limits whatever plan it belongs to: one RouterOS
  // user carries one profile, so taking it over would silently swap the
  // plan they are in the middle of using.
  const live = new Set(
    atLocation
      .filter(
        (voucher) =>
          voucher.status === "active" &&
          (voucher.expiresAt === null ||
            voucher.expiresAt.getTime() > context.now.getTime())
      )
      .map((voucher) => voucher.username)
  );

  if (context.savedUsername && !live.has(context.savedUsername)) {
    const previous =
      atLocation
        .filter((voucher) => voucher.username === context.savedUsername)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ??
      null;
    return { kind: "revive", username: context.savedUsername, previous };
  }

  // `failed` is excluded on purpose: its router user may never have been
  // created, and the owner can still retry it from the Failed Queue, which
  // would then collide with whatever this purchase put on the same name.
  const idle = atLocation
    .filter(
      (voucher) =>
        voucher.status !== "failed" &&
        !live.has(voucher.username)
    )
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

  if (idle) return { kind: "revive", username: idle.username, previous: idle };

  return { kind: "fresh" };
}

/**
 * What the checkout dialog needs in order to ask the question.
 *
 * Derived from `resolveVoucherAction` under `"reuse"` rather than from its
 * own reading of the history, so the preview a buyer is shown and the thing
 * that actually happens when they pay cannot drift apart. That mattered
 * enough to be worth the slightly awkward shape: the alternative is two
 * functions encoding the same rules, and the one the customer sees being
 * the one nobody tests.
 *
 * `reuse: null` means there is nothing to decide and the dialog should ask
 * nothing - this is a first purchase, or everything they hold is busy.
 */
export interface ReuseOption {
  /** `extend` adds to a running plan; `revive` puts this plan on a dead code. */
  mode: "extend" | "revive";
  username: string;
  /** Only for `extend`: what the buyer has now, and what they would have. */
  currentExpiresAt: Date | null;
  newExpiresAt: Date | null;
  /** Only for `revive`: what that code last carried, when we know. */
  previousPlanName: string | null;
  /**
   * The tenant's house rules, carried through to the dialog so it can say
   * "adds to" or "starts again" in the buyer's own words. Under
   * `expiryMode: "reset"` the two dates above can go *backwards*, which is
   * the case the copy exists for.
   */
  expiryMode: RenewalExpiryMode;
  dataMode: RenewalDataMode;
}

export interface PurchaseOptions {
  reuse: ReuseOption | null;
  /**
   * True when they already hold an unused voucher for this exact plan.
   * Not a refusal any more: it blocks `"reuse"` (there is nothing to
   * extend) while leaving `"fresh"` open, because buying a code for
   * somebody else is a normal sale whatever is sitting in your own inbox.
   */
  hasUnusedVoucher: boolean;
}

export function describePurchaseOptions(
  vouchers: Voucher[],
  context: {
    planId: string;
    locationId: string;
    now: Date;
    savedUsername?: string | null;
    /** The tenant's renewal settings; today's behaviour when omitted. */
    modes?: RenewalModes;
  },
  plan: Pick<Plan, "routerDurationValue" | "routerDurationUnit">
): PurchaseOptions {
  const modes = context.modes ?? DEFAULT_RENEWAL_MODES;

  const action = resolveVoucherAction(vouchers, {
    ...context,
    intent: "reuse",
  });

  if (action.kind === "extend") {
    return {
      reuse: {
        mode: "extend",
        username: action.voucher.username,
        currentExpiresAt: action.voucher.expiresAt,
        newExpiresAt: renewalExpiry(
          action.voucher.expiresAt,
          context.now,
          plan,
          modes.expiry
        ),
        previousPlanName: null,
        expiryMode: modes.expiry,
        dataMode: modes.data,
      },
      hasUnusedVoucher: false,
    };
  }

  if (action.kind === "revive") {
    return {
      reuse: {
        mode: "revive",
        username: action.username,
        currentExpiresAt: null,
        newExpiresAt: null,
        previousPlanName: action.previous?.planName ?? null,
        expiryMode: modes.expiry,
        dataMode: modes.data,
      },
      hasUnusedVoucher: false,
    };
  }

  return { reuse: null, hasUnusedVoucher: action.kind === "unactivated" };
}

/**
 * Where a renewed voucher's expiry lands.
 *
 * Under `"extend"`, counted from the **current expiry** rather than from
 * now whenever that is still in the future. That is the point of renewing
 * in place: a customer who tops up with two days left gets those two days
 * plus the new plan, exactly as they would have had if they had waited.
 *
 * Under `"reset"`, counted from `now`, so the plan starts again at the
 * moment it is paid for and whatever was left is discarded. That is a
 * deliberate confiscation and the one thing about it that must not be
 * quiet: the checkout dialog is given both dates (`describePurchaseOptions`
 * below) so the buyer is told before they pay, and
 * `lib/voucher-fulfilment.ts` records what was discarded on the voucher.
 *
 * Note what `"reset"` does **not** do: it does not put the credential back
 * to unactivated so the clock restarts at next login. That would mean
 * writing a null expiry onto a running voucher, which is the exact shape
 * `resolveVoucherAction` reads as "bought and never used", and would leave
 * a customer with a live session on a user the on-login script will not
 * re-stamp until they reconnect.
 *
 * Falls back to `now` for an expiry already in the past, which the caller
 * should not be passing (that is a `fresh` mint) but which must not produce
 * a date that is still behind the clock if it ever does.
 */
export function renewalExpiry(
  currentExpiresAt: Date | null,
  now: Date,
  plan: Pick<Plan, "routerDurationValue" | "routerDurationUnit">,
  mode: RenewalExpiryMode = DEFAULT_RENEWAL_MODES.expiry
): Date {
  const base =
    mode === "extend" &&
    currentExpiresAt &&
    currentExpiresAt.getTime() > now.getTime()
      ? currentExpiresAt
      : now;

  const unitMs = plan.routerDurationUnit === "d" ? 86_400_000 : 3_600_000;
  return new Date(base.getTime() + plan.routerDurationValue * unitMs);
}

/**
 * Where a renewed voucher's `limit-bytes-total` lands.
 *
 * RouterOS measures the user's lifetime counters against this one number, so
 * under `"carry"` adding the new plan's allowance to the existing limit is
 * what carries the unused remainder over: whatever they have not spent is
 * still the gap between the counter and the limit.
 *
 * Under `"reset"` the answer is just the plan's own allowance, and the
 * caller **must** reset the router's byte counters alongside it. Setting the
 * cap on its own would leave a customer who had spent 4 of 5GB sitting at
 * 5GB used against a 5GB limit: already exhausted, on a plan they have just
 * paid for. `lib/voucher-fulfilment.ts` does both, and records what the
 * counters read first so the usage is not simply lost.
 *
 * `"reset"` also drops the stickiness below, deliberately: the plan is
 * applied as bought, so an uncapped credential on a capped plan becomes
 * capped. Under `"carry"` `null` means "no cap" and is sticky in both
 * directions on purpose:
 *
 *  - uncapped user, capped plan -> stays uncapped. The customer is already
 *    entitled to unlimited data on a credential they are using; imposing a
 *    cap mid-flight would be taking something away in the middle of a top-up.
 *  - capped user, uncapped plan -> becomes uncapped, because that is what
 *    they just bought.
 */
export function renewalDataLimitBytes(
  currentLimitBytes: number | null,
  planDataLimit: string | null | undefined,
  mode: RenewalDataMode = DEFAULT_RENEWAL_MODES.data
): number | null {
  if (mode === "reset") return parseDataLimitBytes(planDataLimit);

  if (currentLimitBytes === null) return null;

  const added = parseDataLimitBytes(planDataLimit);
  if (added === null) return null;

  return currentLimitBytes + added;
}

/**
 * Reads `limit-bytes-total` back off a router user.
 *
 * Absent, empty or `0` all mean no cap in RouterOS, and all three come back
 * as `null` here so the caller cannot accidentally treat an uncapped user as
 * one with a zero-byte allowance - which would read as "already exhausted"
 * and cap a customer who had been promised unlimited.
 */
export function parseRouterLimitBytes(
  value: string | null | undefined
): number | null {
  if (!value) return null;
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  return Math.round(bytes);
}
