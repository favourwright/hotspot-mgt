"use client"

import { formatDate } from "@/lib/utils"
import { useEffect } from "react"
import { useAuthStore } from "@/stores/auth-store"
import { useRouter } from "next/navigation"
import { TenantNav } from "@/components/tenant/tenant-nav"
import { AppShell } from "@/components/system/app-shell"
import { PageContent } from "@/components/system/page-content"
import { PageHeader } from "@/components/system/page-header"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/system/empty-state"
import { Ticket } from "lucide-react"
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/system/button"
import { LoadingSpinner } from "@/components/shared/loading-spinner"
import { useCustomerVouchers } from "@/hooks/use-customer-vouchers"
import { tenantHref } from "@/lib/tenant-url";

interface TenantVouchersClientProps {
  tenantId: string
  tenantSlug: string
  businessName: string
}

export function TenantVouchersClient({
  tenantId,
  tenantSlug,
  businessName,
}: TenantVouchersClientProps) {
  const { user } = useAuthStore()
  const router = useRouter()
  const { data, isPending } = useCustomerVouchers(tenantId, Boolean(user))
  const vouchers = data ?? []
  const loading = Boolean(user) && isPending

  useEffect(() => {
    if (!user) {
      router.replace(
        `/auth?redirect=${encodeURIComponent(tenantHref(tenantSlug, "/my-vouchers"))}`
      )
    }
  }, [user, tenantSlug, router])

  if (loading) {
    return (
      <AppShell>
        <TenantNav businessName={businessName} slug={tenantSlug} />
        <div className="flex flex-1 items-center justify-center">
          <LoadingSpinner />
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <TenantNav businessName={businessName} slug={tenantSlug} />

      <PageContent>
        <PageHeader
          title="My vouchers"
          description={`${vouchers.length} voucher${vouchers.length === 1 ? "" : "s"} on this portal`}
        />

        {vouchers.length === 0 ? (
          <SurfaceCard>
            <SurfaceCardContent>
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Ticket />
                  </EmptyMedia>
                  <EmptyTitle>No vouchers yet</EmptyTitle>
                  <EmptyDescription>
                    You haven&apos;t purchased any vouchers yet. Browse the
                    available plans to get started.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button
                    tone="action"
                    onClick={() => router.push(tenantHref(tenantSlug))}
                  >
                    Browse plans
                  </Button>
                </EmptyContent>
              </Empty>
            </SurfaceCardContent>
          </SurfaceCard>
        ) : (
          <div className="space-y-4">
            {vouchers.map((voucher) => (
              <SurfaceCard key={voucher.id}>
                <SurfaceCardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <SurfaceCardTitle>{voucher.planName}</SurfaceCardTitle>
                      <SurfaceCardDescription>
                        {formatDate(voucher.createdAt)}
                      </SurfaceCardDescription>
                    </div>
                    <Badge
                      variant={
                        voucher.status === "active"
                          ? "default"
                          : voucher.status === "expired" ||
                              voucher.status === "superseded"
                            ? "secondary"
                            : "destructive"
                      }
                    >
                      {/* "superseded" is accurate and means nothing to the
                          person who bought it. What happened, from their
                          side, is that they renewed. */}
                      {voucher.status === "superseded"
                        ? "renewed"
                        : voucher.status}
                    </Badge>
                  </div>
                </SurfaceCardHeader>
                <SurfaceCardContent>
                  {voucher.status === "active" && (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="text-muted-foreground">Username</p>
                          <p className="font-mono font-semibold">
                            {voucher.username}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Password</p>
                          <p className="font-mono font-semibold">
                            {voucher.password}
                          </p>
                        </div>
                      </div>
                      <Button
                        tone="raised"
                        className="mt-4 w-full"
                        onClick={() =>
                          router.push(tenantHref(tenantSlug, `/voucher?id=${voucher.id}`))
                        }
                      >
                        View details
                      </Button>
                    </div>
                  )}
                  {voucher.status === "failed" && (
                    <p className="text-sm text-muted-foreground">
                      Voucher generation failed. Please contact support.
                    </p>
                  )}
                  {voucher.status === "superseded" && (
                    <p className="text-sm text-muted-foreground">
                      Renewed. The time and data left on this one were added
                      to your newer voucher, which uses the same login.
                    </p>
                  )}
                </SurfaceCardContent>
              </SurfaceCard>
            ))}
          </div>
        )}
      </PageContent>
    </AppShell>
  )
}
