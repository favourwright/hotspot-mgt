/**
 * POST /api/webhooks/knomad-pay: events from Knomad Pay, Knomad's payment gateway, for
 * tenants moved to it (lib/knomad-pay.ts).
 *
 * Signed with `Knomad-Signature` over a timestamp and the raw body, with the secret
 * Knomad Pay issued this app (KNOMAD_PAY_WEBHOOK_SECRET, comma-separated during a
 * rotation); checked on the body exactly as received, refusing one more than five
 * minutes old. A `charge.succeeded` has already been checked with Monnify by Knomad Pay
 * (amount, currency, reference), and carries the charge's whole state.
 *
 * A voucher sale is fulfilled exactly as Paystack's `charge.success` is: the same
 * function, the same ledger, so the browser, this and the reconcile cron can race and
 * one voucher comes of it. While another caller holds the sale this answers 503, and
 * Knomad Pay delivers it again later.
 *
 * A payment to the platform (`metadata.purpose: "billing"`: a plan period or an addon) is
 * applied from its record (lib/billing-charges.ts), once, whoever reports it first.
 */
import { NextRequest, NextResponse } from "next/server";
import { readEvent, SIGNATURE_HEADER, type Charge } from "@favourwright/knomad-pay-client";
import { fulfilVoucherPurchase } from "@/lib/voucher-fulfilment";
import { resolveSaleBuyer } from "@/lib/sale-buyer";
import { confirmBillingCharge } from "@/lib/billing-charges";

function secrets(): string[] {
  return (process.env.KNOMAD_PAY_WEBHOOK_SECRET ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The sale a charge's metadata names, as the checkout stamped it; null if not a voucher sale. */
function voucherSale(charge: Charge) {
  const m = charge.metadata ?? {};
  if (!m.planId || !m.locationId || !m.tenantId) return null;
  return {
    planId: m.planId,
    locationId: m.locationId,
    tenantId: m.tenantId,
    userId: m.userId || undefined,
    deviceMac: m.deviceMac || null,
    deviceIp: m.deviceIp || null,
  };
}

export async function POST(request: NextRequest) {
  const keys = secrets();
  if (keys.length === 0) {
    console.error("[knomad-pay webhook] KNOMAD_PAY_WEBHOOK_SECRET is not set; refusing events");
    return NextResponse.json({ received: false }, { status: 503 });
  }

  const raw = await request.text();
  const read = readEvent(raw, request.headers.get(SIGNATURE_HEADER), keys);
  if (!read.ok) {
    console.warn(`[knomad-pay webhook] refused: ${read.reason}`);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  const event = read.event;

  if (event.type !== "charge.succeeded") {
    // charge.failed / needs_review and refund events: nothing to fulfil. Failures are
    // found by verify and reconcile; a needs_review charge is Knomad Pay's to raise.
    console.info(`[knomad-pay webhook] ${event.type} for ${event.data.reference}: nothing to do`);
    return NextResponse.json({ received: true });
  }

  const charge = event.data as Charge;
  if (charge.metadata?.purpose === "billing") {
    const result = await confirmBillingCharge(charge.reference);
    if (result.state === "unpaid") {
      // The event says paid; asking the gateway disagreed for now. Delivered again later.
      console.warn(`[knomad-pay webhook] billing ${charge.reference} not confirmed yet: ${result.detail}`);
      return NextResponse.json({ received: false }, { status: 503 });
    }
    if (result.state === "refused") {
      console.error(`[knomad-pay webhook] billing ${charge.reference} refused: ${result.error}`);
    } else {
      console.info(`[knomad-pay webhook] billing ${charge.reference}: ${result.state}`);
    }
    return NextResponse.json({ received: true });
  }

  const sale = voucherSale(charge);
  if (!sale) {
    console.warn(`[knomad-pay webhook] charge.succeeded ${charge.reference} is not a voucher sale`);
    return NextResponse.json({ received: true });
  }

  const buyer = await resolveSaleBuyer(sale.userId, charge.customer.email);
  if (!buyer) {
    console.error(`[knomad-pay webhook] no account for ${charge.customer.email}; cannot attribute sale ${charge.reference}`);
    return NextResponse.json({ received: true });
  }

  const result = await fulfilVoucherPurchase({
    reference: charge.reference,
    planId: sale.planId,
    locationId: sale.locationId,
    tenantId: sale.tenantId,
    deviceMac: sale.deviceMac,
    deviceIp: sale.deviceIp,
    buyer,
  });

  if (result.ok && result.outcome === "in_progress") {
    console.info(`[knomad-pay webhook] ${charge.reference} in progress elsewhere; asking Knomad Pay to deliver it again`);
    return NextResponse.json({ received: false }, { status: 503 });
  }
  if (result.ok) {
    console.info(`[knomad-pay webhook] voucher ${result.outcome} for ${charge.reference} (${sale.tenantId})`);
  } else {
    // Logged, and answered 200: fulfilment has recorded why (a review, a refusal), and
    // delivering the event again would not change it.
    console.error(`[knomad-pay webhook] voucher fulfilment failed for ${charge.reference}: ${result.error}`);
  }
  return NextResponse.json({ received: true });
}
