import Link from "next/link";
import { AlertCircle, PauseCircle } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { tenantHref } from "@/lib/tenant-url";
import { describeFeeDiscount, formatDay, formatNaira } from "@/lib/utils";
import type { PlanFeeState } from "@/lib/fee-waivers";

/**
 * Says, on every admin page rather than just the dashboard, where this
 * tenant stands with their plan fee.
 *
 * The email from the `plan-fee-due` job is still the primary channel; this
 * is for the owner who is already looking at the app. Rendered on the server
 * from the state the settings page uses, so there is no extra request and no
 * flash of a banner that then disappears.
 *
 * ## Three things it says, in increasing order of consequence
 *
 * - **A waiver about to close.** Only inside the last week, and calm: the
 *   grace window has not even started yet.
 * - **A fee owed, still in grace.** Names the date things pause, because
 *   "soon" is what people ignore.
 * - **Locked.** Sales have stopped. This one is `destructive`, and it is the
 *   only one that is, because it is the only one where something has
 *   actually been taken away.
 *
 * That escalation is the whole design. It used to say "your hotspots and
 * vouchers are unaffected" at every stage, which was true when nothing was
 * ever gated and is now a promise this app breaks three days later.
 */
export function PlanFeeNotice({
  state,
  tenantSlug,
}: {
  state: PlanFeeState | null;
  tenantSlug: string;
}) {
  if (!state) return null;
  if (state.status !== "payment-due" && state.status !== "waived") return null;

  const settingsHref = tenantHref(tenantSlug, "/admin/settings");

  if (state.status === "waived") {
    // Only worth saying once the end is in sight. A tenant three weeks into
    // a thirty-day trial does not need a banner on every visit.
    if (!state.waiverEndsAt) return null;
    // This is a **server** component - no "use client" at the top of this
    // file - so it renders once per request and `Date.now()` is simply the
    // time of that request. The purity rule cannot tell the two kinds of
    // component apart, and it is right about the client case: there, a
    // clock read during render disagrees between renders and never updates
    // on its own. Here it is the same derived-from-the-clock design the
    // rest of lib/fee-waivers.ts is built on.
    const daysLeft = Math.ceil(
      // eslint-disable-next-line react-hooks/purity
      (state.waiverEndsAt.getTime() - Date.now()) / 86_400_000
    );
    if (daysLeft > 7) return null;

    const discount = describeFeeDiscount(state.monthlyFee, state.discountKobo);

    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Your {formatNaira(state.monthlyFee)} plan fee is {discount.label} for{" "}
          {daysLeft === 1 ? "one more day" : `${daysLeft} more days`}. You can
          pay now and keep every free day.{" "}
          <Link href={settingsHref} className="underline">
            View billing
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  if (state.locked) {
    return (
      <Alert variant="destructive">
        <PauseCircle className="h-4 w-4" />
        <AlertDescription>
          New voucher sales are paused because your{" "}
          {formatNaira(state.monthlyFee)} plan fee is overdue. Vouchers you
          have already sold still work.{" "}
          <Link href={settingsHref} className="underline">
            Pay or change your plan
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert>
      <AlertCircle className="h-4 w-4" />
      <AlertDescription>
        Your {formatNaira(state.monthlyFee)} plan fee is due.{" "}
        {state.locksAt ? (
          <>
            New sales pause on {formatDay(state.locksAt)}.{" "}
          </>
        ) : null}
        <Link href={settingsHref} className="underline">
          Continue your plan
        </Link>
      </AlertDescription>
    </Alert>
  );
}
