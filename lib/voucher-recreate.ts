/**
 * Whether a sold voucher's login can be put back on the router.
 *
 * ## Why this is not just "is it failed"
 *
 * `/api/voucher/retry` was written for one case: a sale whose router write
 * never landed, sitting in the Failed Queue. So it gated on
 * `status === "failed"`, which was the whole truth at the time.
 *
 * It has since become the endpoint behind the Recreate action on the
 * hotspot-users reconciliation view, whose own comment states the case it
 * exists for: *"missing on the router with a voucher behind it is the case
 * that costs money - someone paid and cannot connect"*. That voucher is
 * `active`, not `failed`, so the one button designed for the expensive case
 * refused it. Two customers were left paying for a plan with no login after
 * `voucher-reap` deleted credentials a later purchase was still using
 * (lib/voucher-reap.ts), and neither could be fixed from the product.
 *
 * ## What the answer turns on
 *
 * The voucher's status and whether the user is on the router, nothing else:
 *
 *  - `failed` is retryable whatever the router holds. That is the original
 *    case, and a failed *renewal* legitimately finds its user present,
 *    because it shares a username with the voucher it was topping up.
 *  - `active` is retryable **only** when the user is missing. If it is
 *    there, nothing is broken and the caller is looking at a stale list.
 *  - `expired` and `superseded` are never retryable. There is no access to
 *    restore: one has run its course, and the other was replaced by a later
 *    purchase which is the document to act on instead.
 *
 * Keeping it here, rather than as four `if`s in the route, is what makes it
 * testable - and this is the decision that was wrong for a fortnight
 * without anything noticing.
 */

export type RecreateVerdict =
  | { ok: true; mode: "patch" | "create" }
  | { ok: false; status: 400 | 409; error: string };

export function recreateVerdict(context: {
  /** The voucher's `status` field, whatever it says. */
  status: string;
  /** Is this voucher a renewal of another (`renewalOf` set)? */
  isRenewal: boolean;
  /** Was a user of this name found on the router? */
  onRouter: boolean;
}): RecreateVerdict {
  const { status, isRenewal, onRouter } = context;

  if (status === "expired") {
    return {
      ok: false,
      status: 400,
      error:
        "This plan has already ended, so there is no access to put back. Sell a new voucher instead.",
    };
  }

  if (status === "superseded") {
    return {
      ok: false,
      status: 400,
      error:
        "A later purchase took over this login. Recreate that voucher instead - this one is already closed out.",
    };
  }

  if (status !== "failed" && status !== "active") {
    return {
      ok: false,
      status: 400,
      error: "This voucher is not in a state that can be put back on the router.",
    };
  }

  if (status === "active" && onRouter) {
    return {
      ok: false,
      status: 409,
      error:
        "This login is already on the router, so there is nothing to put back. Refresh the list.",
    };
  }

  // A renewal whose user is still there is topped up in place: it shares the
  // credential with the voucher it renewed, so creating it again would
  // either fail on the duplicate name or overwrite a login in use.
  //
  // Everything else is created from scratch, renewals included. A renewal
  // whose user has gone is safe to create because the name is free and the
  // figures it needs are absolute: `expiresAt` and `dataLimitBytes` are
  // written to the voucher *before* the router is touched, exactly so a
  // retry sends the same numbers rather than recomputing "what is there
  // now, plus the plan" and topping the customer up twice.
  return { ok: true, mode: isRenewal && onRouter ? "patch" : "create" };
}
