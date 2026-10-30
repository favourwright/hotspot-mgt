import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { parseVoucher } from "@/lib/firestore-helpers";
import { notFound, publicApi } from "@/lib/public-api";
import { publicVoucher } from "@/lib/public-api-serializers";
import { PublicVoucherSchema } from "@/lib/api-schemas";

export const GET = publicApi(
  {
    scope: "vouchers:read",
    summary: "Get a voucher",
    description: "Never includes the password.",
    response: PublicVoucherSchema,
  },
  async ({ tenantId }, { id }: { id: string }) => {
    const voucher = parseVoucher(await adminDb.collection(TENANT_COLLECTIONS.vouchers(tenantId)).doc(id).get());
    if (!voucher) notFound("voucher");
    return { data: publicVoucher(voucher), reads: 1 };
  }
);
