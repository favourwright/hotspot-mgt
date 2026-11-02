import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { parsePayment } from "@/lib/firestore-helpers";
import { paymentDocId } from "@/lib/voucher-fulfilment";
import { notFound, publicApi } from "@/lib/public-api";
import { publicPayment } from "@/lib/public-api-serializers";
import { PublicPaymentSchema } from "@/lib/api-schemas";

export const GET = publicApi(
  { scope: "payments:read", summary: "Get a payment by its reference", response: PublicPaymentSchema },
  async ({ tenantId }, { reference }: { reference: string }) => {
    const payments = adminDb.collection(TENANT_COLLECTIONS.payments(tenantId));
    // Stored at an id derived from the reference; the query is for any
    // written before that was true.
    const direct = await payments.doc(paymentDocId(reference)).get();
    if (direct.exists) return { data: publicPayment(parsePayment(direct)!), reads: 1 };

    const found = await payments.where("paystackReference", "==", reference).limit(1).get();
    if (found.empty) notFound("payment");
    return { data: publicPayment(parsePayment(found.docs[0])!), reads: 2 };
  }
);
