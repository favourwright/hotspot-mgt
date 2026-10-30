/** GET /api/v1/vouchers/{id}. Scope vouchers:read. Never includes the password. */

import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { parseVoucher } from "@/lib/firestore-helpers";
import { notFound, publicApi } from "@/lib/public-api";
import { publicVoucher } from "@/lib/public-api-serializers";

export const GET = publicApi<{ id: string }>("vouchers:read", async ({ tenantId }, { id }) => {
  const voucher = parseVoucher(await adminDb.collection(TENANT_COLLECTIONS.vouchers(tenantId)).doc(id).get());
  if (!voucher) notFound("voucher");
  return { data: publicVoucher(voucher), reads: 1 };
});
