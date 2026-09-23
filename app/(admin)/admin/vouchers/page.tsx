import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { parseVouchers } from "@/lib/firestore-helpers";
import { Voucher } from "@/types/schemas";
import { VouchersClient } from "@/components/admin/vouchers-client";

export const dynamic = "force-dynamic";

async function getVouchers(): Promise<Voucher[]> {
  try {
    const snapshot = await adminDb
      .collection(COLLECTIONS.VOUCHERS)
      .orderBy("createdAt", "desc")
      .get();

    return parseVouchers(snapshot.docs);
  } catch (error) {
    console.error("Error fetching vouchers:", error);
    return [];
  }
}

export default async function VouchersPage() {
  const vouchers = await getVouchers();

  return <VouchersClient vouchers={vouchers} />;
}
