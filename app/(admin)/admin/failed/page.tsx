import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { parseVouchers } from "@/lib/firestore-helpers";
import { Voucher } from "@/types/schemas";
import { FailedVouchersClient } from "@/components/admin/failed-vouchers-client";

export const dynamic = "force-dynamic";

async function getFailedVouchers(): Promise<Voucher[]> {
  try {
    const snapshot = await adminDb
      .collection(COLLECTIONS.VOUCHERS)
      .where("status", "==", "failed")
      .orderBy("createdAt", "desc")
      .get();

    return parseVouchers(snapshot.docs);
  } catch (error) {
    console.error("Error fetching failed vouchers:", error);
    return [];
  }
}

export default async function FailedVouchersPage() {
  const vouchers = await getFailedVouchers();

  return <FailedVouchersClient vouchers={vouchers} />;
}
