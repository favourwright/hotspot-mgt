/**
 * GET /api/v1/customers?limit=&cursor= : newest first by when they first
 * bought. Scope customers:read. `externalId` is only on the single-customer
 * endpoint, to keep a list to one read per customer.
 */

import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { parseTenantCustomers } from "@/lib/firestore-helpers";
import { cursorParam, listMaxReads, pageSize, publicApi } from "@/lib/public-api";
import { publicCustomer } from "@/lib/public-api-serializers";

export const GET = publicApi(
  "customers:read",
  async ({ tenantId, url }) => {
    const limit = pageSize(url);
    const collection = adminDb.collection(TENANT_COLLECTIONS.customers(tenantId));
    // The lib/transactions.ts pattern: a timestamp and the document name, so
    // ties cannot repeat or skip a row, and a DocumentReference for the
    // cursor's second half.
    let query = collection.orderBy("joinedAt", "desc").orderBy("__name__", "desc");
    const cursor = cursorParam(url);
    if (cursor) {
      const sep = cursor.indexOf("_");
      query = query.startAfter(Timestamp.fromMillis(Number(cursor.slice(0, sep))), collection.doc(cursor.slice(sep + 1)));
    }
    const snap = await query.limit(limit + 1).get();
    const customers = parseTenantCustomers(snap.docs.slice(0, limit));
    const last = customers[customers.length - 1];
    const hasMore = snap.docs.length > limit;
    return {
      data: customers.map((c) => publicCustomer(c)),
      nextCursor: hasMore && last ? `${last.joinedAt.getTime()}_${last.uid}` : null,
      reads: Math.max(1, snap.docs.length),
    };
  },
  listMaxReads
);
