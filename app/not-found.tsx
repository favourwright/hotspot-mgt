import Link from "next/link";
import { SearchX } from "lucide-react";

import { AppShell } from "@/components/system/app-shell";
import { Button } from "@/components/system/button";
import {
  SurfaceCard,
  SurfaceCardContent,
} from "@/components/system/surface-card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/system/empty-state";

/**
 * The root 404, which handles two cases:
 *
 * - any URL this app doesn't route
 * - `notFound()` thrown from `app/[tenantSlug]/layout.tsx` for an unknown
 *   portal slug. That throw terminates the layout segment itself, so the
 *   `[tenantSlug]/not-found.tsx` boundary can't catch it -- it renders
 *   *inside* the layout that just bailed. Without this file, those requests
 *   fall through to Next's unstyled built-in 404.
 */
export default function NotFound() {
  return (
    <AppShell center>
      <SurfaceCard>
        <SurfaceCardContent>
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchX />
              </EmptyMedia>
              <EmptyTitle>Page not found</EmptyTitle>
              <EmptyDescription>
                This page doesn&apos;t exist. If you were looking for a hotspot
                portal, check the URL and try again.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                tone="action"
                nativeButton={false}
                render={<Link href="/" />}
              >
                Go to homepage
              </Button>
            </EmptyContent>
          </Empty>
        </SurfaceCardContent>
      </SurfaceCard>
    </AppShell>
  );
}
