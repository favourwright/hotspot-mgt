import { notFound } from "next/navigation";
import { getTenant } from "@/lib/tenant-context";

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
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-bold mb-2">Service Unavailable</h1>
          <p className="text-muted-foreground">
            This hotspot portal is temporarily unavailable. Please contact the
            service provider.
          </p>
        </div>
      </div>
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
