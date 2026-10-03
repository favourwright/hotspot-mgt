import Link from "next/link";
import { ArrowRight, CircleHelp, Store } from "lucide-react";

import { AppShell } from "@/components/system/app-shell";
import { Button } from "@/components/system/button";
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card";

export default function RootPage() {
  return (
    <AppShell center>
      <div className="space-y-6 text-center">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Hotspot Manager
          </h1>
          <p className="mt-2 text-muted-foreground">
            Enter your hotspot portal URL to get started.
          </p>
        </div>

        {/* Pressable in full, with the chip as the visible cue -- the same
            banner the sign-in page opens with. */}
        <SurfaceCard
          density="default"
          action={{ label: "Get started", href: "/onboarding" }}
          className="text-left"
        >
          <SurfaceCardHeader>
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-sunken">
                <Store className="size-5" />
              </span>
              <div className="min-w-0">
                <SurfaceCardTitle className="text-base">
                  Run your own hotspot business
                </SurfaceCardTitle>
                <SurfaceCardDescription>
                  Sell internet vouchers and manage your MikroTik routers from
                  one dashboard.
                </SurfaceCardDescription>
              </div>
            </div>
          </SurfaceCardHeader>
        </SurfaceCard>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            tone="raised"
            nativeButton={false}
            render={<Link href="/faq" />}
          >
            <CircleHelp />
            Visit the FAQ
          </Button>
          <Button
            tone="action"
            nativeButton={false}
            render={<Link href="/auth" />}
          >
            Sign in
            <ArrowRight />
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
