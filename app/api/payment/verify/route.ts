import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { resolvePurchaser, handleAuthError } from "@/lib/auth-helpers";
import { fulfilVoucherPurchase } from "@/lib/voucher-fulfilment";

/**
 * The browser's path to fulfilment: fast, so the captive portal can show
 * credentials and log the device in while the buyer is still looking at it.
 *
 * It is no longer the *only* path. Everything this does now lives in
 * lib/voucher-fulfilment.ts, which the Paystack `charge.success` webhook also
 * drives. That matters because this call is the fragile one: it happens on a
 * device that is still behind the paywall, right after a bank redirect, and
 * when it failed the money arrived with no voucher, no record and no email.
 */

const verifySchema = z.object({
  reference: z.string().min(1),
  planId: z.string().min(1),
  locationId: z.string().min(1),
  tenantId: z.string().min(1),
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
    // What makes the voucher legitimate is still the Paystack reference
    // check inside fulfilment, not who asked for it.
    const purchaser = await resolvePurchaser(
      request.headers.get("authorization")
    );

    const result = await fulfilVoucherPurchase({
      reference,
      planId,
      locationId,
      tenantId,
      deviceMac,
      deviceIp,
      buyer: { uid: purchaser.uid, email: purchaser.email },
    });

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
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
