"use client"

import { useState } from "react"
import { Eye, EyeOff, Wifi, WifiOff } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/system/dialog"
import { Button } from "@/components/system/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { CopyButton } from "@/components/shared/copy-button"
import { formatNaira } from "@/lib/utils"
import { useHotspotUserDetail } from "@/hooks/use-hotspot-user-detail"

interface HotspotUserDialogProps {
  locationId: string | null
  username: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return "-"
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

function formatDateTime(iso: string | null): string {
  if (!iso) return "-"
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/** One label/value line. */
function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right text-sm break-words">{children}</span>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="py-2">
      <h3 className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      <div className="divide-y divide-border">{children}</div>
    </section>
  )
}

export function HotspotUserDialog({
  locationId,
  username,
  open,
  onOpenChange,
}: HotspotUserDialogProps) {
  const [revealPassword, setRevealPassword] = useState(false)
  const detail = useHotspotUserDetail(
    open ? locationId : null,
    open ? username : null
  )

  const data = detail.data

  // Data allowance is only meaningful when the router actually sets one;
  // 0 or absent means unlimited, and "0 B remaining" would be a lie.
  const usedBytes =
    data && (data.bytesIn !== null || data.bytesOut !== null)
      ? (data.bytesIn ?? 0) + (data.bytesOut ?? 0)
      : null
  const hasDataLimit = Boolean(data?.limitBytesTotal)
  const remainingBytes =
    hasDataLimit && usedBytes !== null
      ? Math.max((data?.limitBytesTotal ?? 0) - usedBytes, 0)
      : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-137.5">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {username}
            {data?.session ? (
              <Badge variant="default">
                <Wifi className="size-3" /> Online
              </Badge>
            ) : data ? (
              <Badge variant="outline">
                <WifiOff className="size-3" /> Offline
              </Badge>
            ) : null}
          </DialogTitle>
          <DialogDescription>
            {data
              ? `${data.locationName} - ${data.routerName}`
              : "Loading user details"}
          </DialogDescription>
        </DialogHeader>

        {/* Content scrolls; the footer stays put. */}
        <div className="-mx-6 max-h-[60vh] overflow-y-auto px-6 no-scrollbar">
          {detail.isLoading ? (
            <div className="flex flex-col gap-2 py-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : detail.isError ? (
            <Alert variant="destructive">
              <AlertDescription>
                Couldn&apos;t load this user&apos;s details.
              </AlertDescription>
            </Alert>
          ) : data ? (
            <>
              {!data.routerReachable && (
                <Alert className="mb-2">
                  <WifiOff className="size-4" />
                  <AlertDescription>
                    Couldn&apos;t reach {data.routerName} ({data.routerError}).
                    Showing only what the platform recorded.
                  </AlertDescription>
                </Alert>
              )}

              {data.routerReachable && !data.foundOnRouter && (
                <Alert className="mb-2">
                  <AlertDescription>
                    This user doesn&apos;t exist on {data.routerName}. It was
                    sold through the platform but never created on the router.
                  </AlertDescription>
                </Alert>
              )}

              <Section title="Credentials">
                <Row label="Username">
                  <span className="inline-flex items-center gap-1">
                    <code className="font-mono">{data.username}</code>
                    <CopyButton value={data.username} />
                  </span>
                </Row>
                <Row label="Password">
                  {data.password ? (
                    <span className="inline-flex items-center gap-1">
                      <code className="font-mono">
                        {revealPassword ? data.password : "••••••••"}
                      </code>
                      <Button
                        tone="ghost"
                        scale="sm"
                        onClick={() => setRevealPassword((v) => !v)}
                        aria-label={
                          revealPassword ? "Hide password" : "Show password"
                        }
                      >
                        {revealPassword ? <EyeOff /> : <Eye />}
                      </Button>
                      <CopyButton value={data.password} />
                    </span>
                  ) : (
                    "-"
                  )}
                </Row>
                <Row label="Profile">{data.profile ?? "-"}</Row>
                {data.comment && <Row label="Comment">{data.comment}</Row>}
              </Section>

              <Section title="Plan">
                <Row label="Plan">{data.voucher?.planName ?? "-"}</Row>
                <Row label="Duration">{data.voucher?.duration ?? "-"}</Row>
                <Row label="Expires">{formatDateTime(data.expiresAt)}</Row>
                <Row label="Purchased">
                  {formatDateTime(data.voucher?.purchasedAt ?? null)}
                </Row>
                <Row label="Customer">{data.voucher?.customerEmail ?? "-"}</Row>
              </Section>

              <Section title="Usage">
                <Row label="Data used">
                  {formatBytes(usedBytes)}
                  {hasDataLimit && (
                    <span className="text-muted-foreground">
                      {" "}
                      of {formatBytes(data.limitBytesTotal)}
                    </span>
                  )}
                </Row>
                {remainingBytes !== null && (
                  <Row label="Data remaining">{formatBytes(remainingBytes)}</Row>
                )}
                <Row label="Downloaded">{formatBytes(data.bytesOut)}</Row>
                <Row label="Uploaded">{formatBytes(data.bytesIn)}</Row>
                <Row label="Time used">
                  {data.uptimeUsed ?? "-"}
                  {data.limitUptime && data.limitUptime !== "0s" && (
                    <span className="text-muted-foreground">
                      {" "}
                      of {data.limitUptime}
                    </span>
                  )}
                </Row>
                <Row label="Disabled on router">
                  {data.disabled ? "Yes" : "No"}
                </Row>
              </Section>

              {data.session && (
                <Section title="Current session">
                  <Row label="Online since">
                    {formatDateTime(data.session.onlineSince)}
                  </Row>
                  <Row label="Session time">{data.session.sessionTime}</Row>
                  <Row label="IP address">
                    <code className="font-mono">{data.session.address}</code>
                  </Row>
                  <Row label="MAC address">
                    <code className="font-mono">{data.session.macAddress}</code>
                  </Row>
                  <Row label="This session">
                    {formatBytes(data.session.bytesOut)} down /{" "}
                    {formatBytes(data.session.bytesIn)} up
                  </Row>
                </Section>
              )}

              {data.payment && (
                <Section title="Payment">
                  <Row label="Amount">
                    {formatNaira(data.payment.amountKobo)}
                  </Row>
                  <Row label="Paid">{formatDateTime(data.payment.paidAt)}</Row>
                  <Row label="Status">{data.payment.status}</Row>
                  <Row label="Reference">
                    <span className="inline-flex items-center gap-1">
                      <code className="font-mono text-xs">
                        {data.payment.reference}
                      </code>
                      <CopyButton value={data.payment.reference} />
                    </span>
                  </Row>
                </Section>
              )}
            </>
          ) : null}
        </div>

        <DialogFooter className="mt-6">
          <Button tone="raised" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
