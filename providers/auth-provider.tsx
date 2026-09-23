"use client";

import { useEffect } from "react";
import { onAuthStateChanged, signOut as firebaseSignOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { useAuthStore } from "@/stores/auth-store";
import { useRouter } from "next/navigation";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { setUser, setUserRole, setLoading } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);

      if (firebaseUser && db) {
        try {
          const userDoc = await getDoc(
            doc(db, COLLECTIONS.USERS, firebaseUser.uid)
          );
          if (userDoc.exists()) {
            const userData = userDoc.data();
            setUserRole(userData.role as "customer" | "admin");
          } else {
            setUserRole(null);
          }
        } catch (error) {
          console.error("Error fetching user role:", error);
          setUserRole(null);
        }
      } else {
        setUserRole(null);
      }

      setLoading(false);
    });

    return () => unsubscribe();
  }, [setUser, setUserRole, setLoading]);

  return <>{children}</>;
}

// Export hook for easy access
export function useAuth() {
  const { user, userRole, loading, reset } = useAuthStore();
  const router = useRouter();

  const logout = async () => {
    if (!auth) return;
    try {
      await firebaseSignOut(auth);
      reset();
      router.push("/auth");
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  return { user, userRole, loading, logout };
}
