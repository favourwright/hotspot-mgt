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

export default function TenantNotFound() {
  return (
    <AppShell center>
      <SurfaceCard>
        <SurfaceCardContent>
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchX />
              </EmptyMedia>
              <EmptyTitle>Portal not found</EmptyTitle>
              <EmptyDescription>
                The hotspot portal you&apos;re looking for doesn&apos;t exist.
                Check the URL and try again.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button tone="action" nativeButton={false} render={<Link href="/" />}>
                Go to homepage
              </Button>
            </EmptyContent>
          </Empty>
        </SurfaceCardContent>
      </SurfaceCard>
    </AppShell>
  );
}
