"use client"

import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { EyeOff, Eye, RefreshCw, Trash2, Wifi, WifiOff, Archive } from "lucide-react"

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
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card"
import { CopyButton } from "@/components/shared/copy-button"
import { formatNaira, cn } from "@/lib/utils"
import { Meter } from "@/components/system/meter"
import { parseMikrotikDuration } from "@/lib/mikrotik"
import { useHotspotUserDetail } from "@/hooks/use-hotspot-user-detail"
import { HOTSPOT_USERS_QUERY_KEY } from "@/hooks/use-hotspot-users"
import { hotspotService } from "@/services/admin-service"
import { blockersFrom } from "@/lib/api-client"
import { toast } from "@/components/ui/toast"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/system/alert-dialog"

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

/** Seconds -> "2d 3h", "4h 20m", "45s" — two units is enough to read. */
function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s"
  const units: [string, number][] = [
    ["d", 86400],
    ["h", 3600],
    ["m", 60],
    ["s", 1],
  ]
  const parts: string[] = []
  let remaining = Math.floor(seconds)
  for (const [suffix, size] of units) {
    const amount = Math.floor(remaining / size)
    if (amount > 0) {
      parts.push(`${amount}${suffix}`)
      remaining -= amount * size
    }
    if (parts.length === 2) break
  }
  return parts.join(" ") || "0s"
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

/**
 * Label above value, in a two-column grid.
 *
 * The earlier label-left / value-right rows forced long values (emails,
 * references, MAC addresses) to wrap against a ragged right edge and made
 * the dialog much taller than it needed to be. Stacked pairs put every
 * value on a common left edge, so the panel scans down one line instead of
 * zig-zagging.
 */
function Field({
  label,
  children,
  wide,
}: {
  label: string
  children: React.ReactNode
  wide?: boolean
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", wide && "col-span-2")}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 text-sm break-words">{children}</span>
    </div>
  )
}

/**
 * Each group of fields is a standard SurfaceCard: raised body, default
 * title, and the inset panel the component paints by default -- which is
 * what gives the content its padding and its own fill.
 *
 * The white-on-white problem is solved on the other side instead. A card is
 * `bg-raised` and the dialog is `bg-popover`, the same colour in both
 * themes, so the dialog's scroll area is tinted (see below) and the cards
 * sit on it exactly as they sit on a page's canvas everywhere else. Earlier
 * this was done by overriding the card itself -- a sunken tone plus
 * `inset={false}` -- which made it distinguishable by dismantling the
 * anatomy that makes it a card.
 */
function Section({
  title,
  children,
  grid = true,
}: {
  title: string
  children: React.ReactNode
  grid?: boolean
}) {
  return (
    <SurfaceCard>
      <SurfaceCardHeader>
        <SurfaceCardTitle>{title}</SurfaceCardTitle>
      </SurfaceCardHeader>
      <SurfaceCardContent>
        {grid ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">{children}</div>
        ) : (
          children
        )}
      </SurfaceCardContent>
    </SurfaceCard>
  )
}

export function HotspotUserDialog({
  locationId,
  username,
  open,
  onOpenChange,
}: HotspotUserDialogProps) {
  const [revealPassword, setRevealPassword] = useState(false)
  const [busy, setBusy] = useState<null | "recreate" | "delete" | "archive">(null)
  // The reasons the server gave for refusing an unforced delete. Non-null
  // means the confirmation is open, and it shows exactly these.
  const [deleteBlockers, setDeleteBlockers] = useState<string[] | null>(null)
  const queryClient = useQueryClient()
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
  // Time comes back as MikroTik duration strings ("4h21m"), so both sides
  // are parsed to seconds before they can be compared as a ratio.
  const usedSeconds = parseMikrotikDuration(data?.uptimeUsed ?? undefined)
  const limitSeconds = parseMikrotikDuration(data?.limitUptime ?? undefined)

  // Which actions make sense is decided entirely by where the drift is.
  //
  // Missing on the router with a voucher behind it is the case that costs
  // money -- someone paid and cannot connect -- so recreating is offered
  // first, and dismissing only as the "this one is ancient, stop showing me"
  // escape hatch. A user that *is* on the router can only be removed there;
  // the voucher is never touched from here.
  const canRecreate = Boolean(
    data && data.routerReachable && !data.foundOnRouter && data.voucher
  )
  const canArchive = canRecreate
  const canDelete = Boolean(data && data.routerReachable && data.foundOnRouter)

  const refresh = () => {
    if (locationId) {
      queryClient.invalidateQueries({
        queryKey: HOTSPOT_USERS_QUERY_KEY(locationId),
      })
    }
    detail.refetch()
  }

  const handleRecreate = async () => {
    if (!data?.voucher) return
    setBusy("recreate")
    try {
      await hotspotService.recreateUser(data.voucher.id)
      toast.add({
        title: "Recreated on the router",
        description: `${username} can sign in again.`,
        type: "success",
      })
      refresh()
    } catch (error) {
      toast.add({
        title: "Couldn't recreate this user",
        description: error instanceof Error ? error.message : "Unknown error",
        type: "error",
      })
    } finally {
      setBusy(null)
    }
  }

  const handleArchive = async () => {
    if (!data?.voucher) return
    setBusy("archive")
    try {
      await hotspotService.setVoucherArchived(data.voucher.id, true)
      toast.add({
        title: "Dismissed",
        description:
          "Hidden from this view. The sale, its payment and the customer's copy are all kept.",
        type: "success",
      })
      refresh()
      onOpenChange(false)
    } catch (error) {
      toast.add({
        title: "Couldn't dismiss this row",
        description: error instanceof Error ? error.message : "Unknown error",
        type: "error",
      })
    } finally {
      setBusy(null)
    }
  }

  const handleDelete = async (force: boolean) => {
    if (!locationId || !username) return
    setBusy("delete")
    try {
      await hotspotService.deleteUser(locationId, username, force)
      toast.add({
        title: "Deleted from the router",
        description: `${username} no longer exists on the router.`,
        type: "success",
      })
      refresh()
      onOpenChange(false)
    } catch (error) {
      // A 409 isn't a failure -- it's the server asking for confirmation and
      // handing back the reasons to show.
      const blockers = blockersFrom(error)
      if (blockers) {
        setDeleteBlockers(blockers)
      } else {
        toast.add({
          title: "Couldn't delete this user",
          description: error instanceof Error ? error.message : "Unknown error",
          type: "error",
        })
      }
    } finally {
      setBusy(null)
    }
  }

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

        {/* Content scrolls; the footer stays put. The canvas tint is what
            the raised cards inside read against -- the same figure-ground
            as a page, where white cards sit on `--surface-canvas`. */}
        <div className="-mx-6 max-h-[60vh] overflow-y-auto bg-canvas/80 px-6 py-4 no-scrollbar">
          {detail.isLoading ? (
            <div className="flex flex-col gap-2 py-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full bg-muted-foreground/5" />
              ))}
            </div>
          ) : detail.isError ? (
            <Alert variant="destructive">
              <AlertDescription>
                Couldn&apos;t load this user&apos;s details.
              </AlertDescription>
            </Alert>
          ) : data ? (
            <div className="flex flex-col gap-3">
              {!data.routerReachable && (
                <Alert>
                  <WifiOff className="size-4" />
                  <AlertDescription>
                    Couldn&apos;t reach {data.routerName} ({data.routerError}).
                    Showing only what the platform recorded.
                  </AlertDescription>
                </Alert>
              )}

              {data.routerReachable && !data.foundOnRouter && (
                <Alert>
                  <AlertDescription>
                    This user doesn&apos;t exist on {data.routerName}. It was
                    sold through the platform but never created on the router.
                  </AlertDescription>
                </Alert>
              )}

              {/* Usage leads: it is the question the dialog is usually
                  opened to answer, and the only part with a shape rather
                  than a value. */}
              <Section title="Usage" grid={false}>
                <div className="flex flex-col gap-4">
                  <Meter
                    label="Data"
                    used={usedBytes ?? 0}
                    total={data.limitBytesTotal}
                    format={formatBytes}
                  />
                  <Meter
                    label="Time"
                    used={usedSeconds ?? 0}
                    total={limitSeconds}
                    format={formatDuration}
                  />
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <Field label="Downloaded">
                      {formatBytes(data.bytesOut)}
                    </Field>
                    <Field label="Uploaded">{formatBytes(data.bytesIn)}</Field>
                  </div>
                </div>
              </Section>

              <Section title="Credentials">
                <Field label="Username">
                  <span className="inline-flex items-center gap-1">
                    <code className="font-mono">{data.username}</code>
                    <CopyButton value={data.username} />
                  </span>
                </Field>
                <Field label="Password">
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
                </Field>
                <Field label="Profile">{data.profile ?? "-"}</Field>
                <Field label="Disabled on router">
                  {data.disabled ? "Yes" : "No"}
                </Field>
                {data.comment && (
                  <Field label="Comment" wide>
                    <code className="font-mono text-xs">{data.comment}</code>
                  </Field>
                )}
              </Section>

              <Section title="Plan">
                <Field label="Plan">{data.voucher?.planName ?? "-"}</Field>
                <Field label="Duration">{data.voucher?.duration ?? "-"}</Field>
                <Field label="Expires">{formatDateTime(data.expiresAt)}</Field>
                <Field label="Purchased">
                  {formatDateTime(data.voucher?.purchasedAt ?? null)}
                </Field>
                <Field label="Customer" wide>
                  {data.voucher?.customerEmail ?? "-"}
                </Field>
              </Section>

              {data.session && (
                <Section title="Current session">
                  <Field label="Online since">
                    {formatDateTime(data.session.onlineSince)}
                  </Field>
                  <Field label="Uptime">{data.session.uptime}</Field>
                  <Field label="IP address">
                    <code className="font-mono">{data.session.address}</code>
                  </Field>
                  <Field label="MAC address">
                    <code className="font-mono">{data.session.macAddress}</code>
                  </Field>
                  <Field label="This session" wide>
                    {formatBytes(data.session.bytesOut)} down /{" "}
                    {formatBytes(data.session.bytesIn)} up
                  </Field>
                </Section>
              )}

              {data.payment && (
                <Section title="Payment">
                  <Field label="Amount">
                    {formatNaira(data.payment.amountKobo)}
                  </Field>
                  <Field label="Paid">
                    {formatDateTime(data.payment.paidAt)}
                  </Field>
                  <Field label="Status">{data.payment.status}</Field>
                  <Field label="Reference">
                    <span className="inline-flex items-center gap-1">
                      <code className="font-mono text-xs">
                        {data.payment.reference}
                      </code>
                      <CopyButton value={data.payment.reference} />
                    </span>
                  </Field>
                </Section>
              )}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          {canRecreate && (
            <Button
              tone="action"
              disabled={busy !== null}
              onClick={handleRecreate}
            >
              <RefreshCw className={busy === "recreate" ? "animate-spin" : ""} />
              {busy === "recreate" ? "Recreating..." : "Recreate on router"}
            </Button>
          )}
          {canArchive && (
            <Button
              tone="raised"
              disabled={busy !== null}
              onClick={handleArchive}
            >
              <Archive />
              {busy === "archive" ? "Dismissing..." : "Dismiss this row"}
            </Button>
          )}
          {canDelete && (
            <Button
              tone="raised"
              className="text-destructive hover:bg-destructive hover:text-white"
              disabled={busy !== null}
              onClick={() => handleDelete(false)}
            >
              <Trash2 />
              {busy === "delete" ? "Deleting..." : "Delete from router"}
            </Button>
          )}
          <Button tone="raised" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog
        open={deleteBlockers !== null}
        onOpenChange={(next) => !next && setDeleteBlockers(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {username} anyway?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the user from the router. Because:
            </AlertDialogDescription>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {deleteBlockers?.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <AlertDialogDescription>
              The voucher record and its payment are kept either way — only
              the router is changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setDeleteBlockers(null)
                handleDelete(true)
              }}
            >
              Delete anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}
