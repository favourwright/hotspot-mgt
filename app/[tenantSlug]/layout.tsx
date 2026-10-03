import { notFound } from "next/navigation";
import { getTenant } from "@/lib/tenant-context";
import { AppShell } from "@/components/system/app-shell";
import {
  SurfaceCard,
  SurfaceCardContent,
} from "@/components/system/surface-card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/system/empty-state";
import { PauseCircle } from "lucide-react";

interface TenantLayoutProps {
  children: React.ReactNode;
  params: Promise<{ tenantSlug: string }>;
}

export default async function TenantLayout({
  children,
  params,
}: TenantLayoutProps) {
  const { tenantSlug } = await params;
  const tenant = await getTenant(tenantSlug);

  if (!tenant) {
    notFound();
  }

  if (tenant.status === "suspended") {
    return (
      <AppShell center>
        <SurfaceCard>
          <SurfaceCardContent>
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <PauseCircle />
                </EmptyMedia>
                <EmptyTitle>Service unavailable</EmptyTitle>
                <EmptyDescription>
                  This hotspot portal is temporarily unavailable. Please
                  contact the service provider.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </SurfaceCardContent>
        </SurfaceCard>
      </AppShell>
    );
  }

  return <>{children}</>;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const tenant = await getTenant(tenantSlug);

  return {
    title: tenant
      ? `${tenant.businessName} — Hotspot Portal`
      : "Hotspot Portal",
  };
}
