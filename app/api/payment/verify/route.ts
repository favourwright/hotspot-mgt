import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { resolvePurchaser, handleAuthError } from "@/lib/auth-helpers";
import { fulfilVoucherPurchase } from "@/lib/voucher-fulfilment";
import type { PaymentStanding } from "@/lib/payment-standing";

/**
 * The browser's path to fulfilment: fast, so the captive portal can show
 * credentials and log the device in while the buyer is still looking at it.
 *
 * It is no longer the *only* path. Everything this does now lives in
 * lib/voucher-fulfilment.ts, which Knomad Pay's `charge.succeeded` event also
 * drives. That matters because this call is the fragile one: it happens on a
 * device that is still behind the paywall, right after a bank redirect, and
 * when it failed the money arrived with no voucher, no record and no email.
 */

/** How long to wait on another caller that is mid-way through this sale. */
const IN_PROGRESS_WAIT_MS = 10_000;
const IN_PROGRESS_POLL_MS = 1_500;

const verifySchema = z.object({
  reference: z.string().min(1),
  /**
   * Only needed for a checkout started before /api/purchase/initiate
   * existed. A server-started checkout's record names all three, and
   * fulfilment ignores these when it has one.
   */
  planId: z.string().min(1).optional(),
  locationId: z.string().min(1).optional(),
  tenantId: z.string().min(1).optional(),
  /**
   * Present only for a purchase made from the captive portal, where the
   * router told us which device is asking. Loosely validated on purpose --
   * it is recorded, never trusted for authorisation.
   */
  deviceMac: z
    .string()
    .regex(/^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/)
    .optional(),
  /**
   * The device's address on the hotspot network, from the router's `$(ip)`.
   * Required alongside `deviceMac` to log the device in server-side -- the
   * RouterOS endpoint rejects a login without it.
   */
  deviceIp: z
    .string()
    .regex(/^\d{1,3}(\.\d{1,3}){3}$/)
    .optional(),
});

export async function POST(request: NextRequest) {
  try {
    const validation = verifySchema.safeParse(await request.json());
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    const { reference, planId, locationId, tenantId, deviceMac, deviceIp } =
      validation.data;

    // Every purchase belongs to an account, including one made from the
    // captive portal: the portal sends anyone without one to /auth first.
    // What makes the voucher legitimate is still the payment reference
    // check inside fulfilment, not who asked for it.
    const purchaser = await resolvePurchaser(
      request.headers.get("authorization")
    );

    const fulfilRequest = {
      reference,
      planId: planId ?? "",
      locationId: locationId ?? "",
      tenantId: tenantId ?? "",
      deviceMac,
      deviceIp,
      buyer: { uid: purchaser.uid, email: purchaser.email },
    };

    // The webhook often lands within a second of the browser, and whichever
    // arrives second finds the first one mid-sale. Waiting a few seconds
    // for it to finish is what lets the portal still show credentials in
    // that case, instead of a "check your email" the buyer cannot read from
    // behind the paywall.
    let result = await fulfilVoucherPurchase(fulfilRequest);
    for (
      let waited = 0;
      result.ok && result.outcome === "in_progress" && waited < IN_PROGRESS_WAIT_MS;
      waited += IN_PROGRESS_POLL_MS
    ) {
      await new Promise((resolve) => setTimeout(resolve, IN_PROGRESS_POLL_MS));
      result = await fulfilVoucherPurchase(fulfilRequest);
    }

    if (result.ok && result.outcome === "in_progress") {
      // Not an error, and the one thing the buyer must not do is pay again.
      // Both checkout dialogs show `error` for any response without
      // `success`, so this needs no client change.
      return NextResponse.json(
        {
          success: false,
          inProgress: true,
          standing: { state: "received" } satisfies PaymentStanding,
          error:
            "Your payment went through and your voucher is still being set up. It will arrive by email in a few minutes - please don't pay again.",
        },
        { status: 202 }
      );
    }

    if (!result.ok) {
      return NextResponse.json(
        // `standing` is what the page acts on; `error` is kept for older pages.
        { success: false, error: result.error, standing: result.standing },
        { status: result.status }
      );
    }

    // Only the captive portal gets credentials in the response: it displays
    // them and posts them straight to the router. The storefront reads its
    // voucher from Firestore instead.
    const isPortalPurchase = Boolean(deviceMac);

    return NextResponse.json({
      success: true,
      data: {
        voucherId: result.voucherId,
        ...(result.outcome === "already" ? { alreadyProcessed: true } : {}),
        ...(result.outcome === "pending" ? { failed: true } : {}),
        ...(isPortalPurchase && result.username
          ? { username: result.username, password: result.password }
          : {}),
        ...(result.autoLogin !== undefined
          ? { autoLogin: result.autoLogin }
          : {}),
      },
    });
  } catch (error) {
    console.error("Payment verification error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
