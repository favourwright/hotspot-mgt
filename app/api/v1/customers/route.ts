import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { parseTenantCustomers } from "@/lib/firestore-helpers";
import { listQuery, publicApi } from "@/lib/public-api";
import { publicCustomer } from "@/lib/public-api-serializers";
import { PublicCustomerSchema } from "@/lib/api-schemas";

export const GET = publicApi(
  {
    scope: "customers:read",
    summary: "List customers",
    description:
      "Newest first by when they first bought, paged by cursor. `externalId` is only on the single-customer endpoint, to keep a list to one read per customer.",
    list: true,
    query: z.object(listQuery),
    response: z.array(PublicCustomerSchema),
  },
  async ({ tenantId, query }) => {
    const collection = adminDb.collection(TENANT_COLLECTIONS.customers(tenantId));
    // The lib/transactions.ts pattern: a timestamp and the document name, so
    // ties cannot repeat or skip a row, and a DocumentReference as the
    // cursor's second half.
    let q = collection.orderBy("joinedAt", "desc").orderBy("__name__", "desc");
    if (query.cursor) {
      const sep = query.cursor.indexOf("_");
      q = q.startAfter(
        Timestamp.fromMillis(Number(query.cursor.slice(0, sep))),
        collection.doc(query.cursor.slice(sep + 1))
      );
    }
    const snap = await q.limit(query.limit + 1).get();
    const customers = parseTenantCustomers(snap.docs.slice(0, query.limit));
    const last = customers[customers.length - 1];
    return {
      data: customers.map((c) => publicCustomer(c)),
      nextCursor: snap.docs.length > query.limit && last ? `${last.joinedAt.getTime()}_${last.uid}` : null,
      reads: Math.max(1, snap.docs.length),
    };
  }
);
