import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { collection, query, where, orderBy, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { apiClient } from "@/lib/api-client";

interface FailedVoucher {
  id: string;
  username: string;
  password: string;
  userEmail: string;
  planName: string;
  locationName: string;
  failureReason?: string;
  retryCount?: number;
  lastRetryAt?: any;
  createdAt: any;
}

export const FAILED_VOUCHERS_QUERY_KEY = ["failed-vouchers"];

export function useFailedVouchers() {
  return useQuery({
    queryKey: FAILED_VOUCHERS_QUERY_KEY,
    queryFn: async (): Promise<FailedVoucher[]> => {
      if (!db) {
        throw new Error("Firebase not configured");
      }

      const vouchersQuery = query(
        collection(db, COLLECTIONS.VOUCHERS),
        where("status", "==", "failed"),
        orderBy("createdAt", "desc")
      );
      const snapshot = await getDocs(vouchersQuery);
      const vouchersData = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as FailedVoucher[];

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
