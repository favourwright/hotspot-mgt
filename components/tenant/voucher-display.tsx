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
import { TicketX, Wifi } from "lucide-react"
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
import { Meter } from "@/components/system/meter"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { useVoucherUsage } from "@/hooks/use-voucher-usage"
import type { VoucherUsage } from "@/app/api/voucher/[id]/usage/route"

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
  // Only an active voucher has anything on the router to measure.
  const usage = useVoucherUsage(
    voucherId,
    tenantId,
    voucher?.status === "active"
  )

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

                <VoucherUsageSection
                  usage={usage.data}
                  loading={usage.isLoading}
                  dataLimit={voucher.dataLimit ?? null}
                  duration={voucher.duration}
                  expiresAt={voucher.expiresAt ?? null}
                />

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

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-"
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let i = 0
  let n = bytes
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i += 1
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}

/**
 * When the plan runs out.
 *
 * `expiresAt` is null until the customer first logs in: the router's
 * on-login script is what computes the real expiry, so before then the only
 * honest answer is how long the plan lasts once it starts. Saying "starts on
 * first use" is the difference between a customer thinking their unused
 * voucher is already counting down and knowing it is not.
 */
function ExpiryRow({
  expiresAt,
  duration,
}: {
  expiresAt: Date | null
  duration: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-muted-foreground">
        {expiresAt ? "Expires" : "Valid for"}
      </span>
      <span className="text-right font-medium">
        {expiresAt ? formatDate(expiresAt) : duration}
        {!expiresAt && (
          <span className="block text-xs font-normal text-muted-foreground">
            Starts on first use
          </span>
        )}
      </span>
    </div>
  )
}

/**
 * What the customer has actually used, read live from the router.
 *
 * Deliberately degrades rather than erroring. The plan's own allowance comes
 * from the voucher and is always shown; the *consumption* half needs the
 * router, which may be unreachable, and the user may simply not exist there
 * any more. In both cases the allowance still renders and the live part says
 * so, because "we can't reach your network right now" is a better answer to
 * "how much do I have left" than a blank card.
 */
function VoucherUsageSection({
  usage,
  loading,
  dataLimit,
  duration,
  expiresAt,
}: {
  usage: VoucherUsage | undefined
  loading: boolean
  dataLimit: string | null
  duration: string
  /** Null until first login: the router stamps the real expiry then. */
  expiresAt: Date | null
}) {

  return (
    <div className="space-y-3 pt-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Usage</p>
        {usage?.online && (
          <Badge variant="secondary" className="gap-1">
            <Wifi className="size-3" />
            Connected
          </Badge>
        )}
      </div>

      {loading ? (
        <Skeleton className="h-20 w-full rounded-panel" />
      ) : usage?.routerReachable && usage.foundOnRouter ? (
        // The same meter the owner sees, same component, so the numbers a
        // customer quotes on the phone match the ones support is looking at.
        <Panel tone="sunken" className="space-y-4">
          <Meter
            label="Data"
            used={usage.bytesUsed ?? 0}
            total={usage.limitBytesTotal}
            format={formatBytes}
          />
          <ExpiryRow expiresAt={expiresAt} duration={duration} />
        </Panel>
      ) : (
        // No live numbers. Still show what was bought -- the allowance comes
        // from the voucher and is true regardless of the router -- and say
        // plainly why the consumption half is missing, rather than drawing an
        // empty meter that reads as "nothing used".
        <Panel tone="sunken" className="space-y-2 text-sm">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-muted-foreground">Data</span>
            <span className="font-medium">{dataLimit || "Unlimited"}</span>
          </div>
          <ExpiryRow expiresAt={expiresAt} duration={duration} />
          <p className="pt-1 text-xs text-muted-foreground">
            {usage && !usage.routerReachable
              ? "We can't reach this network right now, so how much you've used isn't shown. Your voucher is unaffected."
              : "This voucher isn't set up on the network at the moment. Contact the business if you think it should still work."}
          </p>
        </Panel>
      )}
    </div>
  )
}
