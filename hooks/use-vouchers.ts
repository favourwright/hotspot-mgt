import { useQuery } from "@tanstack/react-query";
import { collection, query, where, orderBy, getDocs, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { Voucher } from "@/types/schemas";
import { useAuthStore } from "@/stores/auth-store";

// Helper to convert Firestore Timestamp to Date
function convertTimestamps(data: any): any {
  if (!data || typeof data !== "object") return data;

  if (data instanceof Timestamp) {
    return data.toDate();
  }

  if (Array.isArray(data)) {
    return data.map(convertTimestamps);
  }

  const result: any = {};
  for (const [key, value] of Object.entries(data)) {
    result[key] = convertTimestamps(value);
  }
  return result;
}

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
      const vouchersData = snapshot.docs.map((doc) => {
        const data = convertTimestamps(doc.data());
        return {
          id: doc.id,
          ...data,
        } as Voucher;
      });

      return vouchersData;
    },
    enabled: !!user && !!db,
  });
}
