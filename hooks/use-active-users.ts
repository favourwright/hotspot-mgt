import { useQuery } from "@tanstack/react-query";
import { collection, query, where, limit, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firebase-collections";

interface ActiveUser {
  userEmail: string;
}

export function useActiveUsers(isAuthenticated: boolean = false) {
  return useQuery({
    queryKey: ["active-users", isAuthenticated],
    queryFn: async (): Promise<ActiveUser[]> => {
      if (!db || !isAuthenticated) {
        return [];
      }

      try {
        // Fetch up to 3 users who have active vouchers
        const vouchersQuery = query(
          collection(db, COLLECTIONS.VOUCHERS),
          where("status", "==", "active"),
          limit(3)
        );

        const snapshot = await getDocs(vouchersQuery);
        const users = snapshot.docs.map((doc) => ({
          userEmail: doc.data().userEmail,
        }));

        // Remove duplicates by email
        const uniqueUsers = Array.from(
          new Map(users.map(user => [user.userEmail, user])).values()
        );

        return uniqueUsers.slice(0, 3);
      } catch (error) {
        // Silently fail - this is expected for unauthenticated users
        return [];
      }
    },
    enabled: !!db && isAuthenticated, // Only enabled when authenticated AND db exists
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    retry: false, // Don't retry on permission errors
  });
}
