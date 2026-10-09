"use client"

import { formatDate } from "@/lib/utils"
import { useEffect, useState } from "react"
import { useAuthStore } from "@/stores/auth-store"
import { useRouter } from "next/navigation"
import { TenantNav } from "@/components/tenant/tenant-nav"
import { AppShell } from "@/components/system/app-shell"
import { PageContent } from "@/components/system/page-content"
import { Panel } from "@/components/system/surface-card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/system/empty-state"
import { TicketX } from "lucide-react"
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card"
import { Button } from "@/components/system/button"
import { CopyButton } from "@/components/shared/copy-button"
import { LoadingSpinner } from "@/components/shared/loading-spinner"
import { doc, onSnapshot } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { Voucher } from "@/types/schemas"
import { tenantHref } from "@/lib/tenant-url";

interface TenantVoucherDisplayProps {
  tenantId: string
  tenantSlug: string
  businessName: string
  voucherId: string
}

export function TenantVoucherDisplay({
  tenantId,
  tenantSlug,
  businessName,
  voucherId,
}: TenantVoucherDisplayProps) {
  const { user } = useAuthStore()
  const router = useRouter()
  const [voucher, setVoucher] = useState<Voucher | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) {
      router.replace(
        `/auth?redirect=${encodeURIComponent(tenantHref(tenantSlug, `/voucher?id=${voucherId}`))}`
      )
      return
    }

    if (!db) {
      setLoading(false)
      return
    }

    const voucherRef = doc(db, `tenants/${tenantId}/vouchers`, voucherId)
    const unsubscribe = onSnapshot(voucherRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = { id: snapshot.id, ...snapshot.data() } as Voucher

        // Verify the voucher belongs to this user
        if (data.userId !== user.uid) {
          router.replace(tenantHref(tenantSlug))
          return
        }

        setVoucher(data)
      }
      setLoading(false)
    })

    return () => unsubscribe()
  }, [user, tenantId, tenantSlug, voucherId, router])

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

  if (!voucher) {
    return (
      <AppShell>
        <TenantNav businessName={businessName} slug={tenantSlug} />
        <PageContent>
          <SurfaceCard>
            <SurfaceCardContent>
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <TicketX />
                  </EmptyMedia>
                  <EmptyTitle>Voucher not found</EmptyTitle>
                  <EmptyDescription>
                    This voucher doesn&apos;t exist, or it belongs to another
                    account.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button
                    tone="action"
                    onClick={() => router.push(tenantHref(tenantSlug))}
                  >
                    Back to plans
                  </Button>
                </EmptyContent>
              </Empty>
            </SurfaceCardContent>
          </SurfaceCard>
        </PageContent>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <TenantNav businessName={businessName} slug={tenantSlug} />

      <PageContent>
        <SurfaceCard>
          <SurfaceCardHeader>
            <SurfaceCardTitle>Your internet voucher</SurfaceCardTitle>
          </SurfaceCardHeader>
          <SurfaceCardContent className="space-y-6">
            {voucher.status === "active" && (
              <>
                <div className="space-y-4">
                  <div>
                    <p className="mb-1 text-sm text-muted-foreground">
                      Username
                    </p>
                    <div className="flex items-center gap-2">
                      <Panel tone="raised" className="min-w-0 flex-1 py-3">
                        <code className="font-mono text-lg">
                          {voucher.username}
                        </code>
                      </Panel>
                      <CopyButton value={voucher.username} />
                    </div>
                  </div>

                  <div>
                    <p className="mb-1 text-sm text-muted-foreground">
                      Password
                    </p>
                    <div className="flex items-center gap-2">
                      <Panel tone="raised" className="min-w-0 flex-1 py-3">
                        <code className="font-mono text-lg">
                          {voucher.password}
                        </code>
                      </Panel>
                      <CopyButton value={voucher.password} />
                    </div>
                  </div>
                </div>

                {/* Label-over-value, not bold run-in text -- and no rule:
                    the grid's own spacing separates it from the codes. */}
                <div className="grid gap-4 pt-2 text-sm sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-muted-foreground">Plan</p>
                    <p className="font-medium">{voucher.planName}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Created</p>
                    <p className="font-medium">
                      {formatDate(voucher.createdAt)}
                    </p>
                  </div>
                </div>

                <div className="flex gap-2 pt-4 max-md:flex-col">
                  <Button
                    tone="raised"
                    onClick={() => router.push(tenantHref(tenantSlug))}
                  >
                    Buy another plan
                  </Button>
                  <Button
                    tone="action"
                    className="md:flex-1"
                    onClick={() => router.push(tenantHref(tenantSlug, "/my-vouchers"))}
                  >
                    View all vouchers
                  </Button>
                </div>
              </>
            )}

            {voucher.status === "failed" && (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <TicketX className="text-destructive" />
                  </EmptyMedia>
                  <EmptyTitle>Voucher generation failed</EmptyTitle>
                  <EmptyDescription>
                    Something went wrong creating this voucher. Contact support
                    and they&apos;ll sort it out.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button
                    tone="action"
                    onClick={() => router.push(tenantHref(tenantSlug))}
                  >
                    Back to plans
                  </Button>
                </EmptyContent>
              </Empty>
            )}
          </SurfaceCardContent>
        </SurfaceCard>
      </PageContent>
    </AppShell>
  )
}
