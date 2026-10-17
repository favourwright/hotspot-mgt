import { Suspense } from "react";
import Link from "next/link";
import { CircleHelp, Store } from "lucide-react";

import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card";
import { Button } from "@/components/system/button";
import { PageContent } from "@/components/system/page-content";
import { AuthTabs } from "@/components/auth/auth-tabs";

/**
 * Server component: only the tab switcher reads the URL, so everything
 * around it still prerenders. `AuthTabs` calls `useSearchParams`, which
 * requires the Suspense boundary below.
 */
export default function AuthPage() {
  return (
    <>
      {/* Occupies the band a nav bar would, so the page still opens on a
          horizontal object rather than straight into the form. */}
      <div className="flex items-center gap-3">
        <SurfaceCard
          className="flex-1"
          // A banner, not a data card: the 8px compact gutter is too tight
          // around a 44px tile, so it takes the roomier measure.
          density="default"
          action={{ label: "Get started", href: "/onboarding" }}
        >
          <SurfaceCardHeader>
            <div className="flex min-w-0 items-center gap-3">
              {/* size-11 matches the system's 44px control scale -- the same
                  tile size as the nav bar's brand mark and the FAQ pill
                  beside it. At size-10 it read as 4px short of everything. */}
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-sunken">
                <Store className="size-5" />
              </span>
              <div className="min-w-0">
                <SurfaceCardTitle className="truncate text-base">
                  Run your own hotspot business
                </SurfaceCardTitle>
                <SurfaceCardDescription className="truncate">
                  Sell vouchers and manage your routers from one dashboard.
                </SurfaceCardDescription>
              </div>
            </div>
          </SurfaceCardHeader>
        </SurfaceCard>
      </div>

      <PageContent className="items-center justify-center">
        <div className="flex flex-col items-end gap-2">
          <Button
            tone="raised"
            nativeButton={false}
            className=""
            render={<Link href="/faq" />}
            aria-label="Help and FAQ"
          >
            <CircleHelp />
            <span>FAQ</span>
          </Button>

          <div className="w-full max-w-md">
            <SurfaceCard>
              <SurfaceCardHeader className="text-center">
                <SurfaceCardTitle className="text-2xl">Welcome</SurfaceCardTitle>
                <SurfaceCardDescription>
                  Login or create an account to get started
                </SurfaceCardDescription>
              </SurfaceCardHeader>
              <SurfaceCardContent>
                <Suspense fallback={<AuthTabsFallback />}>
                  <AuthTabs />
                </Suspense>
              </SurfaceCardContent>
            </SurfaceCard>

            <p className="mt-6 px-8 text-center text-sm text-muted-foreground">
              By continuing, you agree to our{" "}
              <Link href="/acceptable-use" className="underline hover:text-foreground">
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link href="/privacy" className="underline hover:text-foreground">
                Privacy Policy
              </Link>
              .
            </p>
          </div>
        </div>
      </PageContent>
    </>
  );
}

/** Holds the tab track's space until the URL-aware switcher hydrates. */
function AuthTabsFallback() {
  return <div className="h-9 w-full rounded-lg bg-raised" aria-hidden />;
}
