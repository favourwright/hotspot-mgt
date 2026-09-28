import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { FieldValue } from "firebase-admin/firestore";

async function verifyPaystackWebhook(
  payload: string,
  signature: string
): Promise<boolean> {
  const secret = process.env.PAYSTACK_SECRET_KEY!;
  const hash = crypto
    .createHmac("sha512", secret)
    .update(payload)
    .digest("hex");
  return hash === signature;
}

async function findTenantByCustomerCode(
  customerCode: string
): Promise<string | null> {
  const snapshot = await adminDb
    .collection(COLLECTIONS.TENANTS)
    .where("paystackCustomerCode", "==", customerCode)
    .limit(1)
    .get();

  if (snapshot.empty) return null;
  return snapshot.docs[0].id;
}

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
    const eventType = event.event;
    const data = event.data;

    switch (eventType) {
      case "invoice.payment_failed": {
        // Subscription payment failed
        const customerCode = data?.customer?.customer_code;
        if (!customerCode) break;

        const tenantId = await findTenantByCustomerCode(customerCode);
        if (!tenantId) break;

        await adminDb
          .collection(COLLECTIONS.TENANTS)
          .doc(tenantId)
          .update({
            subscriptionStatus: "past_due",
            updatedAt: FieldValue.serverTimestamp(),
          });
        break;
      }

      case "invoice.payment_succeeded":
      case "charge.success": {
        // Subscription payment succeeded
        const customerCode = data?.customer?.customer_code;
        if (!customerCode) break;

        const tenantId = await findTenantByCustomerCode(customerCode);
        if (!tenantId) break;

        // Calculate next billing date (30 days)
        const nextBillingDate = new Date();
        nextBillingDate.setDate(nextBillingDate.getDate() + 30);

        await adminDb
          .collection(COLLECTIONS.TENANTS)
          .doc(tenantId)
          .update({
            status: "active",
            subscriptionStatus: "active",
            nextBillingDate,
            updatedAt: FieldValue.serverTimestamp(),
          });
        break;
      }

      case "subscription.create": {
        // Captures the subscription code created when a tenant's first
        // payment (initialized with a plan code) went through — this is
        // not returned synchronously from transaction/verify.
        const customerCode = data?.customer?.customer_code;
        const subscriptionCode = data?.subscription_code;
        if (!customerCode || !subscriptionCode) break;

        const tenantId = await findTenantByCustomerCode(customerCode);
        if (!tenantId) break;

        await adminDb
          .collection(COLLECTIONS.TENANTS)
          .doc(tenantId)
          .update({
            paystackSubscriptionCode: subscriptionCode,
            updatedAt: FieldValue.serverTimestamp(),
          });
        break;
      }

      case "subscription.not_renew": {
        // Subscription cancelled
        const customerCode = data?.customer?.customer_code;
        if (!customerCode) break;

        const tenantId = await findTenantByCustomerCode(customerCode);
        if (!tenantId) break;

        await adminDb
          .collection(COLLECTIONS.TENANTS)
          .doc(tenantId)
          .update({
            subscriptionStatus: "cancelled",
            updatedAt: FieldValue.serverTimestamp(),
          });
        break;
      }

      default:
        // Ignore other events
        break;
    }

    // Always return 200 to Paystack
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Webhook error:", error);
    // Still return 200 to prevent Paystack retries
    return NextResponse.json({ received: true });
  }
}
