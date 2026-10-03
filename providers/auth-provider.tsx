"use client";

import { useEffect } from "react";
import { onIdTokenChanged, signOut as firebaseSignOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { useAuthStore } from "@/stores/auth-store";
import { normalizeRole } from "@/lib/auth-claims";
import { Tenant } from "@/types/schemas";
import { useRouter } from "next/navigation";
import { clearSession } from "@/lib/session-client";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { setUser, setUserRole, setLoading, setTenant, setTenantId } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return;
    }

    // onIdTokenChanged (not onAuthStateChanged) - it also fires on a forced
    // token refresh (getIdToken(true)), which is how the app picks up a
    // role/tenant change (e.g. right after onboarding) without a full reload.
    const unsubscribe = onIdTokenChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);

      if (firebaseUser) {
        if (!db) {
          setLoading(false);
          return;
        }
        try {
          // Role and tenant come off the token's custom claims - no read.
          // Accounts that predate claims fall back to the user document,
          // which the server backfills on their next authenticated request.
          const tokenResult = await firebaseUser.getIdTokenResult();
          let role = normalizeRole(tokenResult.claims.role);
          let tenantId =
            typeof tokenResult.claims.tenantId === "string"
              ? tokenResult.claims.tenantId
              : null;

          if (!role) {
            const userDoc = await getDoc(
              doc(db, COLLECTIONS.USERS, firebaseUser.uid)
            );
            if (userDoc.exists()) {
              const userData = userDoc.data();
              role = normalizeRole(userData.role);
              tenantId = userData.tenantId ?? null;
            }
          }

          if (role) {
            setUserRole(role);

            // If owner, load their tenant
            if (role === "owner" && tenantId) {
              // Retry up to 3 times with 1 second delay
              // in case token is mid-refresh
              let attempts = 0;
              const loadTenant = async (): Promise<void> => {
                try {
                  const tenantDoc = await getDoc(
                    doc(db!, COLLECTIONS.TENANTS, tenantId!)
                  );
                  if (tenantDoc.exists()) {
                    const data = tenantDoc.data();
                    const tenantData = {
                      id: tenantDoc.id,
                      ...data,
                      createdAt: data.createdAt?.toDate?.() || new Date(),
                      updatedAt: data.updatedAt?.toDate?.() || new Date(),
                      nextBillingDate: data.nextBillingDate?.toDate?.() || null,
                    };
                    setTenant(tenantData as Tenant);
                    setTenantId(tenantId);
                  }
                } catch (error) {
                  attempts++;
                  if (attempts < 3) {
                    console.warn(`Tenant load attempt ${attempts} failed, retrying...`);
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                    await loadTenant();
                  } else {
                    console.error("Failed to load tenant after 3 attempts:", error);
                  }
                }
              };
              await loadTenant();
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
      await clearSession();
      await firebaseSignOut(auth);
      reset();
      router.push("/auth");
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  return { user, userRole, loading, logout };
}
