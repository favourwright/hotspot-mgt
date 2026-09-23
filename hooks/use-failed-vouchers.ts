import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { collection, query, where, orderBy, getDocs, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { apiClient } from "@/lib/api-client";
import { Voucher } from "@/types/schemas";

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

export const FAILED_VOUCHERS_QUERY_KEY = ["failed-vouchers"];

export function useFailedVouchers() {
  return useQuery({
    queryKey: FAILED_VOUCHERS_QUERY_KEY,
    queryFn: async (): Promise<Voucher[]> => {
      if (!db) {
        throw new Error("Firebase not configured");
      }

      const vouchersQuery = query(
        collection(db, COLLECTIONS.VOUCHERS),
        where("status", "==", "failed"),
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
    enabled: !!db,
  });
}

export function useRetryVoucher() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (voucherId: string) => {
      const response = await apiClient.post("/api/voucher/retry", { voucherId });
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: FAILED_VOUCHERS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["admin", "stats"] });
    },
  });
}
