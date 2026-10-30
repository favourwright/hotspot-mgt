/** GET /api/v1/payments/{reference} : by Paystack reference. Scope payments:read. */

import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { parsePayment } from "@/lib/firestore-helpers";
import { paymentDocId } from "@/lib/voucher-fulfilment";
import { notFound, publicApi } from "@/lib/public-api";
import { publicPayment } from "@/lib/public-api-serializers";

export const GET = publicApi<{ reference: string }>(
  "payments:read",
  async ({ tenantId }, { reference }) => {
    const payments = adminDb.collection(TENANT_COLLECTIONS.payments(tenantId));
    // Payments are stored at an id derived from the reference; the query is
    // for any written before that was true.
    const direct = await payments.doc(paymentDocId(reference)).get();
    if (direct.exists) return { data: publicPayment(parsePayment(direct)!), reads: 1 };

    const found = await payments.where("paystackReference", "==", reference).limit(1).get();
    if (found.empty) notFound("payment");
    return { data: publicPayment(parsePayment(found.docs[0])!), reads: 2 };
  },
  () => 2
);
