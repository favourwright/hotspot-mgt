import Link from "next/link";
import { AlertCircle } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { tenantHref } from "@/lib/tenant-url";
import { describeFeeDiscount, formatNaira } from "@/lib/utils";
import type { PlanFeeState } from "@/lib/fee-waivers";

/**
 * Says, on the page an owner actually lands on, that their plan fee is owed
 * or about to be.
 *
 * The email from the `plan-fee-due` job is the primary channel; this is for
 * the owner who is already looking at their dashboard. Rendered on the
 * server from the state the settings page uses, so there is no extra request
 * and no flash of a banner that then disappears.
 *
 * Deliberately not alarming. Nothing is suspended when a plan fee goes
 * unpaid - vouchers keep selling and customers keep getting online - so a
 * destructive-looking banner would be lying about the stakes.
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
      <Alert className="mb-6">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Your {formatNaira(state.monthlyFee)} plan fee is {discount.label} for{" "}
          {daysLeft === 1 ? "one more day" : `${daysLeft} more days`}. Nothing
          stops working when it ends.{" "}
          <Link href={settingsHref} className="underline">
            View billing
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert className="mb-6">
      <AlertCircle className="h-4 w-4" />
      <AlertDescription>
        Your {formatNaira(state.monthlyFee)} plan fee is due. Your hotspots and
        vouchers are unaffected.{" "}
        <Link href={settingsHref} className="underline">
          Continue your plan
        </Link>
      </AlertDescription>
    </Alert>
  );
}
