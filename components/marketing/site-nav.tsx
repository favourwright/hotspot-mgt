"use client";

import * as React from "react";
import Link from "next/link";
import { Wifi } from "lucide-react";
import { useLenis } from "lenis/react";

import { cn, getAvatarUrl } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";
import { useAuthStore } from "@/stores/auth-store";
import { postLoginHref } from "@/lib/post-login-destination";
import { BRAND, NAV_ACTIONS, NAV_LINKS } from "@/lib/landing-content";
import { Button } from "@/components/system/button";
import { TopNav } from "@/components/system/top-nav";
import { CONTENT_WIDTHS } from "@/components/system/widths";

/**
 * The landing page's navigation.
 *
 * The bar itself is the product's own `TopNav`, not a lookalike: the frame,
 * the radius, the pill group and the mobile sheet all come from the shared
 * component, so the landing page cannot drift away from the rest of the app
 * the first time one of them changes.
 *
 * What is local to here is only what the landing page genuinely needs
 * differently:
 *
 * - **Its own sticky container.** `TopNav`'s built-in sticky mode pairs a
 *   negative top margin with a canvas-coloured band, which assumes it is
 *   sitting in `AppShell`'s gutter and masks content scrolling underneath.
 *   Neither holds here: there is no `AppShell`, and a canvas band would cut
 *   a flat stripe across the top of the hero's rounded surface. So it is
 *   mounted with `sticky={false}` and floated over the hero instead.
 * - **Lenis.** The sheet locks body scroll and Lenis keeps driving its own
 *   position straight through that lock.
 * - **A real brand mark** rather than the generated tile tenants get.
 */
export function SiteNav() {
  const [scrolled, setScrolled] = React.useState(false);

  /**
   * The landing page knew nothing about sessions, so it offered "Sign in"
   * to people who were already signed in.
   *
   * `loading` matters as much as the result. Auth resolves a tick after
   * first paint, so rendering the signed-out actions while it is unknown
   * shows "Sign in" and then swaps it, which is worse than showing
   * nothing for that tick. The accent button is unaffected either way, so
   * only the left-hand slot waits.
   */
  const { user, userRole, tenant, loading } = useAuthStore();
  // The shared logout, which clears the server session cookie as well as
  // the Firebase one. A bare signOut leaves the cookie and the client
  // bootstrap trades it straight back - see `tenant-nav.tsx`.
  const { logout } = useAuth();

  // The same destination signing in would have produced. Null while an
  // owner's tenant is still loading, which is why the link is omitted
  // rather than pointed at a guess.
  const dashboard = postLoginHref(userRole, tenant?.slug);
  // Customers have no apex destination of their own - `/` is this page -
  // so they get the avatar menu and nothing else.
  const showDashboard =
    !!user && dashboard !== null && userRole !== "customer";
  // An owner or superadmin is already selling, or runs the platform.
  const showStartSelling = !user || userRole === "customer";
  const lenis = useLenis(({ scroll }: { scroll: number }) => {
    // Runs every frame while scrolling. React bails out of a state update
    // that sets the same value, so this only re-renders on the crossing.
    setScrolled(scroll > 24);
  });

  const onMenuOpenChange = React.useCallback(
    (open: boolean) => {
      if (!lenis) return;
      if (open) lenis.stop();
      else lenis.start();
    },
    [lenis]
  );

  // The sheet can be open when this unmounts, which would leave Lenis
  // stopped and the page frozen.
  React.useEffect(() => () => lenis?.start(), [lenis]);

  return (
    <header
      className="sticky top-0 z-50 h-(--nav-height) pt-[calc(var(--hero-top)+var(--nav-inset))] pb-2"
      // The hero is pulled up underneath this bar, so everything except the
      // bar itself has to let the pointer through.
      style={{ pointerEvents: "none" }}
    >
      <div
        className={cn(
          "mx-auto w-full px-4 sm:px-6 lg:px-8",
          CONTENT_WIDTHS.default
        )}
      >
        <div
          style={{ pointerEvents: "auto" }}
          className={cn(
            // The only shadow anywhere in this design language, and it is
            // behaviour rather than decoration: once the page scrolls, the
            // bar floats over arbitrary content instead of sitting on the
            // canvas, and the tint cycle cannot separate it from something
            // whose colour it does not know. Absent at rest.
            "rounded-2xl transition-shadow duration-300",
            scrolled && "shadow-lg shadow-stone-500/5"
          )}
        >
          <TopNav
            sticky={false}
            onMenuOpenChange={onMenuOpenChange}
            brand={{
              label: BRAND,
              href: "/",
              icon: (
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-foreground text-background">
                  <Wifi className="size-5" />
                </span>
              ),
            }}
            items={NAV_LINKS}
            user={
              user
                ? {
                    name: user.displayName,
                    email: user.email,
                    avatarUrl: getAvatarUrl(user.uid),
                  }
                : undefined
            }
            onLogout={user ? logout : undefined}
            action={
              <>
                {loading ? null : showDashboard ? (
                  <Button
                    tone="ghost"
                    nativeButton={false}
                    className="max-sm:hidden"
                    render={<Link href={dashboard} />}
                  >
                    Dashboard
                  </Button>
                ) : user ? null : (
                  <Button
                    tone="ghost"
                    nativeButton={false}
                    className="max-sm:hidden"
                    render={<Link href={NAV_ACTIONS.signIn.href} />}
                  >
                    {NAV_ACTIONS.signIn.label}
                  </Button>
                )}

                {/* The accent on a control, which the system reserves for
                    the case where `action`'s one-black-pill-per-page
                    assumption does not hold. It does not hold here: the
                    hero carries the page's `action` button, and a second
                    near-black pill in the bar directly above it reads as
                    two primaries competing. */}
                {showStartSelling && (
                  <Button
                    tone="accent"
                    nativeButton={false}
                    render={<Link href={NAV_ACTIONS.start.href} />}
                  >
                    {NAV_ACTIONS.start.label}
                  </Button>
                )}
              </>
            }
          />
        </div>
      </div>
    </header>
  );
}
