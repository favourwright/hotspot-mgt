"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { useAuthStore } from "@/stores/auth-store";
import { goToPostLoginDestination } from "@/lib/post-login-destination";
import { reconcileClientSession } from "@/lib/session-client";

/**
 * Keeps `/auth` away from people who are already signed in.
 *
 * Follows the same shape as the other guards in this codebase
 * (`app/superadmin/layout.tsx`, `app/(onboarding)/layout.tsx`): decide in
 * an effect, then mirror the decision in the render so the thing you are
 * about to be redirected away from never flashes first.
 *
 * ## Why this is a component and not the route group's layout
 *
 * `app/(auth)/layout.tsx` also wraps `/auth/action`, which is Firebase's
 * action handler: password resets, email verification and email changes
 * all land there. Those links are followed by signed-in people as a
 * matter of course - changing your email only makes sense while signed
 * in - so a gate on the group would break the one flow that most needs
 * to work. It belongs on the page.
 *
 * ## Why it cannot loop
 *
 * Every redirect to `/auth` in this codebase fires only when there is no
 * user. This fires only when there is one. Two conditions that cannot
 * both be true cannot alternate.
 *
 * That holds only while "there is a user" means the same thing on both
 * sides, and for a while it did not. The server reads the session cookie;
 * this reads Firebase's per-origin client state; and signing out on a
 * subdomain clears the cookie for the whole domain while leaving the
 * apex's IndexedDB untouched. `ogawifi.online/superadmin` then bounced to
 * `/auth?redirect=/superadmin` on the server's answer and straight back on
 * this one, forever. An expired or revoked cookie reaches the same state
 * without anybody signing out of anything.
 *
 * So this gate asks the server before it bounces anyone. It is the single
 * place a disagreement can close a loop, which makes it the right place to
 * pay one round trip: `reconcileClientSession({ force: true })` either
 * confirms the session or signs this origin out of one that is already
 * gone, and a visitor who turns out to be signed out gets the form they
 * came for. `AuthProvider` runs the same reconciliation on every page from
 * the hint cookie, so the stale state is usually gone before this runs;
 * `force` is what also catches a revoked cookie, which leaves the hint
 * behind.
 *
 * The destination comes from `goToPostLoginDestination`, which is also
 * what sign-in uses, and is deliberately role-based rather than a
 * `?redirect=` or `?next=` from the URL. Honouring a return URL here is
 * the thing that would build a loop: a stale link pointing at a page
 * that bounces this role would send them back to `/auth`, which would
 * bounce them again. See that module for the full reasoning.
 */
export function SignedInGate({ children }: { children: React.ReactNode }) {
  const { user, userRole, tenant, tenantId, loading } = useAuthStore();
  const router = useRouter();

  // An owner's destination needs their tenant slug, which the auth
  // provider loads a moment after the role settles. Waiting for it avoids
  // bouncing them to `/` only to have the dashboard become reachable a
  // tick later.
  const awaitingOwnerTenant =
    userRole === "owner" && tenantId !== null && tenant === null;

  // Set when the server says the session behind this client state is gone.
  // `signOut()` clears the store a moment later, but the form is the right
  // thing to show from the moment we know, and showing it does not depend
  // on that listener having fired.
  const [sessionGone, setSessionGone] = React.useState(false);
  // One check per mount. The effect re-runs as the role and tenant settle,
  // and this must not become a request per render.
  const checked = React.useRef(false);

  React.useEffect(() => {
    if (loading || !user || awaitingOwnerTenant) return;
    if (checked.current) return;
    checked.current = true;

    let cancelled = false;

    void (async () => {
      // Never redirect a signed-in visitor off this page on client state
      // alone: that belief is what loops when the server no longer shares
      // it. See the note above.
      const verdict = await reconcileClientSession({ force: true });
      if (cancelled) return;

      if (verdict === "stale") {
        setSessionGone(true);
        return;
      }
      // The cookie is another account's; the provider is signing in as it.
      // Check again once that user arrives rather than redirecting this one.
      if (verdict === "switched") {
        checked.current = false;
        return;
      }

      void goToPostLoginDestination(router, {
        role: userRole,
        tenantSlug: tenant?.slug ?? null,
        // Replace, so the Back button does not return to a sign-in page
        // that would immediately bounce them again.
        replace: true,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [user, userRole, tenant, tenantId, loading, awaitingOwnerTenant, router]);

  // Mirror the effect's conditions exactly. A signed-in visitor should
  // never see the sign-in form, not even for the frame before the
  // redirect commits - unless they turn out not to be signed in at all,
  // in which case the form is exactly what they are owed.
  if (loading) return null;
  if (user && !sessionGone) return null;

  return <>{children}</>;
}
