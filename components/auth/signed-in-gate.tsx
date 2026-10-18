"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { useAuthStore } from "@/stores/auth-store";
import { goToPostLoginDestination } from "@/lib/post-login-destination";

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

  React.useEffect(() => {
    if (loading || !user || awaitingOwnerTenant) return;

    void goToPostLoginDestination(router, {
      role: userRole,
      uid: user.uid,
      tenantId,
      tenantSlug: tenant?.slug ?? null,
      // Replace, so the Back button does not return to a sign-in page
      // that would immediately bounce them again.
      replace: true,
    });
  }, [user, userRole, tenant, tenantId, loading, awaitingOwnerTenant, router]);

  // Mirror the effect's conditions exactly. A signed-in visitor should
  // never see the sign-in form, not even for the frame before the
  // redirect commits.
  if (loading) return null;
  if (user) return null;

  return <>{children}</>;
}
