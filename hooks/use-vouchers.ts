import { useQuery } from "@tanstack/react-query";
import { collection, query, where, orderBy, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { Voucher } from "@/types";
import { useAuthStore } from "@/stores/auth-store";

export function useVouchers() {
  const user = useAuthStore((state) => state.user);

  return useQuery({
    queryKey: ["vouchers", user?.uid],
    queryFn: async (): Promise<Voucher[]> => {
      if (!db || !user) {
        throw new Error("Firebase not configured or user not authenticated");
      }

      const vouchersQuery = query(
        collection(db, COLLECTIONS.VOUCHERS),
        where("userId", "==", user.uid),
        orderBy("createdAt", "desc")
      );

      const snapshot = await getDocs(vouchersQuery);
      const vouchersData = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as Voucher[];

      return vouchersData;
    },
    enabled: !!user && !!db,
  });
}
