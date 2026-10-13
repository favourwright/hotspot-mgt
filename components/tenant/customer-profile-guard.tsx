"use client";

import { useEffect } from "react";

import { useAuth } from "@/providers/auth-provider";
import { authUrlWithNext } from "@/lib/safe-redirect";
import { SurfaceCard, SurfaceCardHeader, SurfaceCardDescription, SurfaceCardTitle } from "@/components/system/surface-card";

/**
 * Keeps the profile page to signed-in visitors.
 *
 * Client-side rather than a server gate because the customer pages are
 * rendered for anonymous visitors too, and this is the same `?next=` round
 * trip the portal already uses - Firebase persists auth per origin, so a
 * tenant subdomain has to go through it to know who is there at all.
 *
 * Nothing sensitive hangs on this: everything inside reads from the signed
 * in user's own token, and every write behind it is re-checked server-side.
 */
export function CustomerProfileGuard({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading || user) return;
    window.location.assign(authUrlWithNext(window.location.href));
  }, [loading, user]);

  if (loading || !user) {
    return (
      <SurfaceCard>
        <SurfaceCardHeader>
          <SurfaceCardTitle>Just a moment</SurfaceCardTitle>
          <SurfaceCardDescription>
            Checking who you are...
          </SurfaceCardDescription>
        </SurfaceCardHeader>
      </SurfaceCard>
    );
  }

  return <>{children}</>;
}
