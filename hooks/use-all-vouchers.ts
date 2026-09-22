import { useQuery } from "@tanstack/react-query";
import { collection, query, orderBy, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firebase-collections";

interface Voucher {
  id: string;
  username: string;
  password: string;
  userEmail: string;
  planName: string;
  locationName: string;
  duration: string;
  status: string;
  createdAt: any;
}

export const ALL_VOUCHERS_QUERY_KEY = ["all-vouchers"];

export function useAllVouchers() {
  return useQuery({
    queryKey: ALL_VOUCHERS_QUERY_KEY,
    queryFn: async (): Promise<Voucher[]> => {
      if (!db) {
        throw new Error("Firebase not configured");
      }

      const vouchersQuery = query(
        collection(db, COLLECTIONS.VOUCHERS),
        orderBy("createdAt", "desc")
      );
      const snapshot = await getDocs(vouchersQuery);
      const vouchersData = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as Voucher[];

      return vouchersData;
    },
    enabled: !!db,
  });
}
