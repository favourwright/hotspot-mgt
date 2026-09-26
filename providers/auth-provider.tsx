"use client";

import { useEffect } from "react";
import { onAuthStateChanged, signOut as firebaseSignOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { useAuthStore } from "@/stores/auth-store";
import { Tenant } from "@/types/schemas";
import { useRouter } from "next/navigation";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { setUser, setUserRole, setLoading, setTenant, setTenantId } = useAuthStore();
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
            
            // Backward compat: treat "admin" as "owner"
            let role = userData.role;
            if (role === "admin") role = "owner";
            
            setUserRole(role as "superadmin" | "owner" | "customer");
            
            // If owner, load their tenant
            if (role === "owner" && userData.tenantId) {
              try {
                const tenantDoc = await getDoc(
                  doc(db, COLLECTIONS.TENANTS, userData.tenantId)
                );
                if (tenantDoc.exists()) {
                  const tenantData = {
                    id: tenantDoc.id,
                    ...tenantDoc.data(),
                    createdAt: tenantDoc.data().createdAt?.toDate(),
                    updatedAt: tenantDoc.data().updatedAt?.toDate(),
                    nextBillingDate: tenantDoc.data().nextBillingDate?.toDate() || null,
                  };
                  setTenant(tenantData as Tenant);
                  setTenantId(userData.tenantId);
                }
              } catch (error) {
                console.error("Failed to load tenant:", error);
              }
            } else {
              setTenant(null);
              setTenantId(null);
            }
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
  }, [setUser, setUserRole, setLoading, setTenant, setTenantId]);

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
