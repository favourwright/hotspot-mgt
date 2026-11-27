/**
 * POST /api/admin/voucher-generation/credits/checkout: a tenant owner starts
 * buying voucher generation credits.
 *
 * The price is the platform's per-credit price (platform/config, set on
 * /superadmin/config) times the number asked for, worked out here, never
 * sent by the browser. Returns Monnify's checkout through Knomad Pay; the
 * credits are added when the charge is applied (lib/billing-charges.ts), by
 * whichever of the return page, Knomad Pay's event or the reconcile cron
 * reports it first. See docs/voucher-generation.md.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireUnlockedOwner } from "@/lib/billing-lock";
import { VOUCHER_GENERATION_ADDON } from "@/lib/addon-catalog";
import { requireAddon } from "@/lib/entitlements";
import { getPlatformConfig } from "@/lib/platform-config";
import { startBillingCharge } from "@/lib/billing-charges";
import { generationErrorResponse } from "@/lib/voucher-generation-http";
import { MAX_CREDIT_PURCHASE } from "@/lib/voucher-generation-rules";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  credits: z.number().int().positive().max(MAX_CREDIT_PURCHASE),
});

export async function POST(request: NextRequest) {
  try {
    const caller = await requireUnlockedOwner(request.headers.get("authorization"));
    // Credits only generate codes, so buying them without the addon would
    // be paying for something unusable.
    await requireAddon(caller.tenantId, VOUCHER_GENERATION_ADDON);

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: `Buy between 1 and ${MAX_CREDIT_PURCHASE} credits.` },
        { status: 400 }
      );
    }
    const { credits } = parsed.data;
    const { creditPriceKobo, minCreditPurchase } = (await getPlatformConfig()).voucherGeneration;
    if (creditPriceKobo <= 0) {
      return NextResponse.json(
        { success: false, error: "Credits are not on sale online yet. Contact us for a top-up." },
        { status: 409 }
      );
    }
    if (credits < minCreditPurchase) {
      return NextResponse.json(
        { success: false, error: `Buy at least ${minCreditPurchase} credits at a time.` },
        { status: 400 }
      );
    }

    const started = await startBillingCharge({
      kind: "credits",
      tenantId: caller.tenantId,
      uid: caller.uid,
      email: caller.email,
      credits,
      priceKobo: credits * creditPriceKobo,
      description: `${credits} voucher generation credits`,
    });
    if (!started.ok) {
      return NextResponse.json({ success: false, error: started.error }, { status: started.status });
    }
    return NextResponse.json({
      success: true,
      data: { reference: started.reference, checkoutUrl: started.checkoutUrl, amount: started.amountKobo },
    });
  } catch (error) {
    return generationErrorResponse(error);
  }
}
