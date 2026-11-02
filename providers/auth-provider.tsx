"use client";

import { useEffect, useRef } from "react";
import { onIdTokenChanged, signOut as firebaseSignOut } from "@firebase/auth";
import { auth } from "@/lib/firebase";
import { fetchAccountSummary, type AccountSummary } from "@/lib/account-client";
import { useAuthStore } from "@/stores/auth-store";
import { normalizeRole } from "@/lib/auth-claims";
import { useRouter } from "next/navigation";
import {
  clearSession,
  reconcileClientSession,
  restoreClientSession,
} from "@/lib/session-client";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { setUser, setUserRole, setLoading, setTenant, setTenantId } = useAuthStore();
  const router = useRouter();
  // One attempt per mount. A failed restore must not be retried on every
  // subsequent signed-out event, and a *successful* sign-out must not be
  // undone by one.
  const restoreAttempted = useRef(false);

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
        // Firebase says signed in, which is only half the answer: its
        // persistence is per-origin, and a sign-out on another subdomain
        // (or a cookie that simply expired) leaves this origin believing
        // in a session the server has already let go. Settle that before
        // anything downstream acts on it - a page that trusts it gets
        // bounced by the server and bounced back here by the gate on
        // /auth, forever. See lib/session-reconcile.ts.
        //
        // Costs nothing in the ordinary case: the hint cookie answers it
        // without a request.
        const reconciled = await reconcileClientSession();
        if (reconciled === "stale" || reconciled === "switched") {
          // signOut() re-fires this listener with no user, and that pass
          // is the one that finishes. `loading` deliberately stays true
          // until then, for the same reason the restore path leaves it
          // true: a guard seeing `loading:false, user:null` mid-flight
          // redirects to /auth.
          //
          // "switched" kept the cookie, and that pass must be free to
          // restore from it even if this page restored once already. After
          // "stale" the hint is gone, so allowing it costs no request.
          restoreAttempted.current = false;
          return;
        }

        try {
          // Role and tenant come off the token's custom claims - no request.
          // The server is only asked for what claims cannot answer: an account
          // that predates them, or the name and slug of an owner's tenant.
          const tokenResult = await firebaseUser.getIdTokenResult();
          let role = normalizeRole(tokenResult.claims.role);
          let tenantId =
            typeof tokenResult.claims.tenantId === "string"
              ? tokenResult.claims.tenantId
              : null;

          let summary: AccountSummary | null = null;
          if (!role || (role === "owner" && tenantId)) {
            // Retried in case the token is mid-refresh.
            for (let attempt = 1; ; attempt++) {
              try {
                summary = await fetchAccountSummary(tokenResult.token);
                break;
              } catch (error) {
                if (attempt >= 3) throw error;
                console.warn(`Account lookup attempt ${attempt} failed, retrying...`);
                await new Promise((resolve) => setTimeout(resolve, 1000));
              }
            }
          }

          if (!role && summary) {
            role = summary.role;
            tenantId = summary.tenantId;
          }

          if (role) {
            setUserRole(role);

            if (role === "owner" && tenantId && summary?.tenant) {
              setTenant(summary.tenant);
              setTenantId(tenantId);
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

        // Signed out as far as this origin's IndexedDB is concerned -- but
        // that is exactly what a valid session looks like on a tenant
        // subdomain, since Firebase persistence doesn't cross origins. Try
        // to trade the session cookie for a custom token before concluding
        // anyone is actually logged out.
        //
        // Nothing happens here after a real sign-out: clearSession() deletes
        // the hint cookie *before* signOut() fires this listener, so there's
        // nothing left to restore from.
        if (!restoreAttempted.current) {
          restoreAttempted.current = true;
          const restored = await restoreClientSession();
          // `loading` deliberately stays true: signing in re-fires this
          // listener with a user, and that pass is the one that finishes.
          // Releasing it here would let the admin layout see
          // `loading:false, user:null` and redirect to /auth mid-restore.
          if (restored) return;
        }
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
