import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { fulfilVoucherPurchase } from "@/lib/voucher-fulfilment";
import { resolveSaleBuyer } from "@/lib/sale-buyer";
import { parsePaystackMetadata } from "@/lib/paystack";

/**
 * Paystack's webhook, for voucher sales by tenants still on Paystack.
 *
 * Only `charge.success` for a voucher is acted on. Platform billing (plan periods and
 * addons) moved to Knomad Pay as one-off payments (lib/billing-charges.ts), so Paystack's
 * subscription and invoice events no longer mean anything here and are ignored. The
 * Paystack account itself is closed; this goes with the rest of Paystack in phase 3c.
 */

async function verifyPaystackWebhook(
  payload: string,
  signature: string,
): Promise<boolean> {
  const secret = process.env.PAYSTACK_SECRET_KEY!;
  const hash = crypto
    .createHmac("sha512", secret)
    .update(payload)
    .digest("hex");

  // Both sides are hex of a fixed-length digest, so a length mismatch here
  // means a malformed header rather than a near-miss guess.
  const a = Buffer.from(hash);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * A customer buying a voucher, identified by the metadata the checkout
 * dialogs attach. This is the server-to-server safety net for the one thing
 * that used to depend entirely on the buyer's browser surviving a bank
 * redirect on a captive portal: a payment arrived, the browser never called
 * /api/payment/verify, and the charge was silently dropped here because the
 * buyer's customer code is not a tenant's.
 */
function voucherMetadata(data: unknown): {
  planId: string;
  locationId: string;
  tenantId: string;
  deviceMac?: string;
  deviceIp?: string;
  userId?: string;
} | null {
  const m = parsePaystackMetadata((data as { metadata?: unknown })?.metadata);
  if (!m) return null;

  const str = (key: string) =>
    typeof m[key] === "string" && m[key] ? (m[key] as string) : undefined;

  const planId = str("planId");
  const locationId = str("locationId");
  const tenantId = str("tenantId");
  if (!planId || !locationId || !tenantId) return null;

  return {
    planId,
    locationId,
    tenantId,
    deviceMac: str("deviceMac"),
    deviceIp: str("deviceIp"),
    userId: str("userId"),
  };
}

/**
 * Who the voucher belongs to.
 *
 * The webhook has no token, so the uid has to come from somewhere else:
 * the metadata the checkout attached, or a lookup on the email Paystack
 * charged. Returns null rather than inventing an identity - a voucher
 * attributed to the wrong account is worse than one this path leaves for
 * the browser or the reconciliation job to issue.
 */
async function resolveWebhookBuyer(
  metadataUserId: string | undefined,
  email: string | undefined,
): Promise<{ uid: string; email: string } | null> {
  const buyer = await resolveSaleBuyer(metadataUserId, email);
  if (!buyer && email)
    console.error(`[webhook] no account for ${email}; cannot attribute sale`);
  return buyer;
}

/* ------------------------------------------------------------- handler */

export async function POST(request: NextRequest) {
  try {
    const signature = request.headers.get("x-paystack-signature");
    if (!signature) {
      return NextResponse.json({ error: "No signature" }, { status: 400 });
    }

    const payload = await request.text();
    const isValid = await verifyPaystackWebhook(payload, signature);

    if (!isValid) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const event = JSON.parse(payload);
    const data = event.data;

    const sale =
      event.event === "charge.success" ? voucherMetadata(data) : null;
    if (sale) {
      const buyer = await resolveWebhookBuyer(
        sale.userId,
        typeof data?.customer?.email === "string"
          ? data.customer.email
          : undefined,
      );
      if (!buyer) return NextResponse.json({ received: true });

      const result = await fulfilVoucherPurchase({
        reference: data.reference,
        planId: sale.planId,
        locationId: sale.locationId,
        tenantId: sale.tenantId,
        deviceMac: sale.deviceMac,
        deviceIp: sale.deviceIp,
        buyer,
      });

      // Another caller is mid-way through this sale. Answering 503 makes
      // Paystack retry later, by which point it is either finished or
      // its lease has lapsed and the retry resumes it.
      if (result.ok && result.outcome === "in_progress") {
        console.info(
          `[webhook] ${data.reference} in progress elsewhere; asking Paystack to retry`,
        );
        return NextResponse.json({ received: false }, { status: 503 });
      }

      // Logged either way. A webhook that silently declines to fulfil is
      // how the original failure stayed invisible for a day.
      if (result.ok) {
        console.info(
          `[webhook] voucher ${result.outcome} for ${data.reference} ` +
            `(${sale.tenantId})`,
        );
      } else {
        console.error(
          `[webhook] voucher fulfilment failed for ${data.reference}: ` +
            result.error,
        );
      }
    }

    // Always return 200 to Paystack
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Webhook error:", error);
    // Still return 200 to prevent Paystack retries
    return NextResponse.json({ received: true });
  }
}
