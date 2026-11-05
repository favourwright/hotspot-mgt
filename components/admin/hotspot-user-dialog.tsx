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
import { useHotspotUserDetail } from "@/hooks/use-hotspot-user-detail"
import type { HotspotUserPurchase } from "@/lib/hotspot-user-detail"
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

/**
 * One line saying what a renewal did to what the customer already had.
 *
 * Only says anything when something was actually taken: under the default
 * settings a renewal adds to both the time and the data, which the dates
 * above already show, and a line repeating it on every row would bury the
 * rows where something was reset.
 */
function describeRenewal(
  renewal: HotspotUserPurchase["renewal"] | null
): string | null {
  if (!renewal) return null

  const parts: string[] = []
  if (renewal.expiryMode === "reset") {
    parts.push(
      renewal.previousExpiresAt
        ? `Time restarted, replacing a plan running to ${formatDateTime(renewal.previousExpiresAt)}`
        : "Time restarted"
    )
  }
  if (renewal.dataMode === "reset") {
    parts.push(
      renewal.previousBytesUsed !== null
        ? `Data restarted, with ${formatBytes(renewal.previousBytesUsed)} used`
        : "Data restarted"
    )
  }

  return parts.length > 0 ? parts.join(". ") + "." : null
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
  const [confirmDelete, setConfirmDelete] = useState(false)
  // Reasons the *server* refused an unforced delete. Normally null, because
  // the confirmation below already asked using what the dialog knows; this
  // only fills in when the server saw something the loaded detail didn't --
  // someone connecting between opening this dialog and confirming.
  const [serverBlockers, setServerBlockers] = useState<string[] | null>(null)
  const queryClient = useQueryClient()
  const detail = useHotspotUserDetail(
    open ? locationId : null,
    open ? username : null
  )

  const data = detail.data

  // Data allowance is only meaningful when the router actually sets one;
  // 0 or absent means unlimited, and "0 B remaining" would be a lie.
  //
  // Summed on the server, not here: an open session's bytes are not in the
  // router's user counters yet, so this is not `bytesIn + bytesOut` of one
  // record and must not be re-derived as if it were.
  const usedBytes = data?.bytesUsed ?? null
  // Time comes back as MikroTik duration strings ("4h21m"), so both sides
  // are parsed to seconds before they can be compared as a ratio.

  // Which actions make sense is decided entirely by where the drift is.
  //
  // Missing on the router with a voucher behind it is the case that costs
  // money -- someone paid and cannot connect -- so recreating is offered
  // first, and dismissing only as the "this one is ancient, stop showing me"
  // escape hatch. A user that *is* on the router can only be removed there;
  // the voucher is never touched from here.
  //
  // The status check mirrors the server's (lib/voucher-recreate.ts) so the
  // button is absent rather than offered and then refused: there is nothing
  // to put back for a plan that has ended, and a superseded voucher's
  // credential belongs to the purchase that took it over.
  const canRecreate = Boolean(
    data &&
      data.routerReachable &&
      !data.foundOnRouter &&
      data.voucher &&
      (data.voucher.status === "active" || data.voucher.status === "failed")
  )
  const canArchive = canRecreate
  const canDelete = Boolean(data && data.routerReachable && data.foundOnRouter)

  // The same two conditions the DELETE endpoint checks, mirrored here so the
  // confirmation can name them before the request rather than only after a
  // refusal. The server still decides -- this is the wording, not the gate.
  const voucherIsLive =
    data?.voucher?.status === "active" &&
    (!data.expiresAt || new Date(data.expiresAt) > new Date())

  const deleteWarnings: string[] = []
  if (voucherIsLive && data?.voucher) {
    deleteWarnings.push(
      `${data.voucher.customerEmail ?? "A customer"} has a live ${data.voucher.planName} voucher for this user. Deleting it takes away access they paid for.`
    )
  }
  if (data?.session) {
    deleteWarnings.push(
      data.sessionCount > 1
        ? `This user has ${data.sessionCount} devices connected right now, and all of them will be disconnected.`
        : `This user is connected right now (${data.session.macAddress}) and will be disconnected.`
    )
  }

  const shownWarnings = serverBlockers ?? deleteWarnings

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
        // The situation changed under us. Re-ask with what the server
        // actually sees rather than what this dialog loaded earlier.
        setServerBlockers(blockers)
        setConfirmDelete(true)
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
                {/*
                  Shown only once there is more than one sale on this login.
                  "Purchased" above is the current plan's own date, which is
                  what the row is about; this is the day the customer first
                  appeared, which a single-purchase login already states.
                */}
                {data.purchaseCount > 1 && (
                  <>
                    <Field label="First purchased">
                      {formatDateTime(data.firstPurchasedAt)}
                    </Field>
                    <Field label="Purchases on this login">
                      {data.purchaseCount}
                    </Field>
                  </>
                )}
                <Field label="Customer" wide>
                  {data.voucher?.customerEmail ?? "-"}
                </Field>
              </Section>

              {data.session && (
                <Section
                  title={
                    data.sessionCount > 1
                      ? `Current session (longest of ${data.sessionCount} devices)`
                      : "Current session"
                  }
                >
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
                  {data.purchaseCount > 1 && (
                    <Field label="Note" wide>
                      <span className="text-muted-foreground text-xs">
                        The latest payment on this login. Earlier ones are
                        listed below.
                      </span>
                    </Field>
                  )}
                </Section>
              )}

              {/*
                Every sale that has been put on this code, newest first.
                This panel is the answer to the two questions a renewal
                leaves behind - what did they pay before, and what did
                renewing cost them - neither of which survives anywhere else
                once the router has been rewritten.
              */}
              {(data.history?.length ?? 0) > 1 && (
                <Section title="Purchase history" grid={false}>
                  <ul className="space-y-3">
                    {data.history?.map((entry) => (
                      <li
                        key={entry.voucherId}
                        className="flex flex-col gap-0.5 border-b pb-3 last:border-0 last:pb-0"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                          <span className="text-sm font-medium">
                            {entry.planName}
                            {entry.isRenewal ? " (renewal)" : ""}
                          </span>
                          <span className="text-sm">
                            {entry.amountKobo === null
                              ? "-"
                              : formatNaira(entry.amountKobo)}
                          </span>
                        </div>
                        <span className="text-muted-foreground text-xs">
                          {formatDateTime(entry.purchasedAt)}
                          {entry.status === "failed" ? " - failed" : ""}
                        </span>
                        {describeRenewal(entry.renewal) && (
                          <span className="text-muted-foreground text-xs">
                            {describeRenewal(entry.renewal)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {(canRecreate || canArchive || canDelete) && (
                // In the content rather than the footer: these need a line of
                // explanation each to be safe to press, and a footer is the
                // wrong place for prose. It also keeps the destructive action
                // away from Close, which is the button muscle memory reaches
                // for on the way out.
                <Section title="Fix this record" grid={false}>
                  <div className="space-y-3">
                    {canRecreate && (
                      <ActionRow
                        description="This user was sold but isn't on the router. Put it back so the customer can sign in."
                        button={
                          <Button
                            tone="action"
                            scale="sm"
                            disabled={busy !== null}
                            onClick={handleRecreate}
                          >
                            <RefreshCw
                              className={busy === "recreate" ? "animate-spin" : ""}
                            />
                            {busy === "recreate" ? "Recreating..." : "Recreate"}
                          </Button>
                        }
                      />
                    )}
                    {canArchive && (
                      <ActionRow
                        description="Hide this row if the router will never have it again. The sale, its payment and the customer's copy are all kept, and it can be brought back."
                        button={
                          <Button
                            tone="raised"
                            scale="sm"
                            disabled={busy !== null}
                            onClick={handleArchive}
                          >
                            <Archive />
                            {busy === "archive" ? "Dismissing..." : "Dismiss"}
                          </Button>
                        }
                      />
                    )}
                    {canDelete && (
                      <ActionRow
                        description="Remove this user from the router. The voucher and payment records are kept - only the router changes."
                        button={
                          <Button
                            tone="raised"
                            scale="sm"
                            className="text-destructive hover:bg-destructive hover:text-white"
                            disabled={busy !== null}
                            onClick={() => setConfirmDelete(true)}
                          >
                            <Trash2 />
                            {busy === "delete" ? "Deleting..." : "Delete"}
                          </Button>
                        }
                      />
                    )}
                  </div>
                </Section>
              )}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button tone="raised" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog
        open={confirmDelete}
        onOpenChange={(next) => {
          if (!next) {
            setConfirmDelete(false)
            setServerBlockers(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {username} from the router?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the user from the router immediately. It can&apos;t
              be undone from here - the user would have to be recreated.
            </AlertDialogDescription>
            {shownWarnings.length > 0 && (
              <>
                <AlertDialogDescription>
                  {serverBlockers
                    ? "This changed since you opened the dialog:"
                    : "Before you do:"}
                </AlertDialogDescription>
                <ul className="list-disc space-y-1 pl-5 text-sm text-destructive">
                  {shownWarnings.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </>
            )}
            <AlertDialogDescription>
              The voucher record and its payment are kept either way - only
              the router is changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                // `force` reflects what this person was actually shown. Having
                // read the warnings above is the acknowledgement the server
                // asks for -- but when there were none to show, the request
                // goes unforced so the server can still refuse on something
                // that changed since the dialog loaded, and we re-ask with
                // its reasons rather than deleting on stale information.
                const acknowledged = shownWarnings.length > 0
                setConfirmDelete(false)
                setServerBlockers(null)
                handleDelete(acknowledged)
              }}
            >
              Delete from router
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}

/** One action: what it does on the left, the button on the right. */
function ActionRow({
  description,
  button,
}: {
  description: string
  button: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <p className="text-sm text-muted-foreground">{description}</p>
      <div className="shrink-0">{button}</div>
    </div>
  )
}
