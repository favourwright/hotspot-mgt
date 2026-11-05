"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  AlertCircle,
  Ban,
  Coins,
  Copy,
  Download,
  Eye,
  Layers,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Printer,
  Ticket,
} from "lucide-react"

import type {
  BatchDetail,
  BatchSummary,
  GenerationQuotaView,
} from "@/lib/voucher-generation"
import type { GeneratedCodeFormat } from "@/types/schemas"
import { codeSpaceBits } from "@/lib/generated-code-alphabets"
import { apiClient } from "@/lib/api-client"
import { copyTextToClipboard } from "@/lib/clipboard"
import { tenantBasePath } from "@/lib/tenant-url"
import { formatDate, formatNaira } from "@/lib/utils"
import { PageHeader } from "@/components/system/page-header"
import { Button as SystemButton } from "@/components/system/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/system/dropdown-menu"
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card"
import { StatCard } from "@/components/system/stat-card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/system/empty-state"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { toast } from "@/components/ui/toast"

interface PlanOption {
  id: string
  name: string
  locationId: string
  duration: string
  dataLimit: string | null
  price: number
}

interface VoucherGenerationClientProps {
  tenantSlug: string
  businessName: string
  canEdit: boolean
  entitled: boolean
  initialQuota: GenerationQuotaView
  initialFormat: GeneratedCodeFormat
  limits: { maxBatchSize: number; maxUnusedPerRouter: number }
  initialBatches: BatchSummary[]
  locations: Array<{ id: string; name: string }>
  plans: PlanOption[]
}

const CHARSET_LABELS: Record<GeneratedCodeFormat["charset"], string> = {
  alnum: "Letters and digits",
  letters: "Letters only",
  digits: "Digits only",
}

const PASSWORD_LABELS: Record<GeneratedCodeFormat["passwordMode"], string> = {
  same: "Same as the code",
  separate: "Separate password",
}

const STATE_LABEL: Record<BatchSummary["state"], string> = {
  minting: "Putting on router",
  ready: "Ready",
  partial: "Partly failed",
  failed: "Failed",
}

const CODE_STATUS_LABEL: Record<BatchDetail["codes"][number]["status"], string> = {
  pending: "Waiting",
  unused: "Unused",
  active: "Used",
  void: "Void",
  failed: "Failed",
}

function newRequestId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** Codes worth handing out: on the router, nobody has used them. */
function printable(batch: BatchDetail) {
  return batch.codes.filter((c) => c.status === "unused")
}

/**
 * What a customer needs to log in, as one message: for the clipboard and
 * for WhatsApp alike, so the two never say different things.
 */
function codeMessage(
  batch: BatchDetail,
  code: { username: string; password: string },
  businessName: string
): string {
  const plan = [batch.planName, batch.plan.duration, batch.plan.dataLimit].filter(Boolean).join(", ")
  const login =
    code.username === code.password
      ? `Code: ${code.username}`
      : `Username: ${code.username}\nPassword: ${code.password}`
  return `${businessName} WiFi\n${plan}\n${login}`
}

async function copyCode(batch: BatchDetail, code: { username: string; password: string }, businessName: string) {
  const ok = await copyTextToClipboard(codeMessage(batch, code, businessName))
  toast.add(
    ok
      ? { title: "Copied", description: code.username, type: "success" }
      : { title: "Couldn't copy", description: "Your browser blocked the clipboard.", type: "error" }
  )
}

/** Opens WhatsApp with the message ready; the owner picks who it goes to. */
function shareOnWhatsApp(batch: BatchDetail, code: { username: string; password: string }, businessName: string) {
  const url = `https://wa.me/?text=${encodeURIComponent(codeMessage(batch, code, businessName))}`
  window.open(url, "_blank", "noopener,noreferrer")
}

function downloadCsv(batch: BatchDetail) {
  const rows = [
    ["username", "password", "plan", "location", "status"],
    ...batch.codes
      .filter((c) => c.status !== "failed" && c.status !== "void")
      .map((c) => [c.username, c.password, batch.planName, batch.locationName, CODE_STATUS_LABEL[c.status]]),
  ]
  const blob = new Blob([rows.map((r) => r.map(csvCell).join(",")).join("\n")], {
    type: "text/csv;charset=utf-8",
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `codes-${batch.planName.replace(/\W+/g, "-")}-${batch.id}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

/** A sheet of cut-out cards, one per unused code, in a new tab to print. */
function printSheet(batch: BatchDetail, businessName: string) {
  const codes = printable(batch)
  const cards = codes
    .map((c) => {
      const same = c.username === c.password
      return `<div class="card">
  <div class="biz">${escapeHtml(businessName)}</div>
  <div class="plan">${escapeHtml(batch.planName)} &middot; ${escapeHtml(batch.plan.duration)}${
        batch.plan.dataLimit ? ` &middot; ${escapeHtml(batch.plan.dataLimit)}` : ""
      }</div>
  ${
    same
      ? `<div class="label">Code</div><div class="code">${escapeHtml(c.username)}</div>`
      : `<div class="label">Username</div><div class="code">${escapeHtml(c.username)}</div>
  <div class="label">Password</div><div class="code">${escapeHtml(c.password)}</div>`
  }
</div>`
    })
    .join("\n")
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(batch.planName)} codes</title>
<style>
body{font-family:system-ui,sans-serif;margin:12mm}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm}
.card{border:1px dashed #999;border-radius:3mm;padding:4mm;break-inside:avoid}
.biz{font-weight:600;font-size:12px}
.plan{font-size:11px;color:#555;margin-bottom:2mm}
.label{font-size:9px;text-transform:uppercase;color:#777;letter-spacing:.05em}
.code{font-family:ui-monospace,monospace;font-size:16px;font-weight:600;letter-spacing:.08em}
</style></head><body><div class="grid">${cards}</div></body></html>`
  const win = window.open("", "_blank")
  if (!win) {
    toast.add({ title: "Allow pop-ups for this site to print the sheet", type: "error" })
    return
  }
  win.document.write(html)
  win.document.close()
  win.focus()
  win.print()
}

export function VoucherGenerationClient({
  tenantSlug,
  businessName,
  canEdit,
  entitled,
  initialQuota,
  initialFormat,
  limits,
  initialBatches,
  locations,
  plans,
}: VoucherGenerationClientProps) {
  const [quota, setQuota] = useState(initialQuota)
  const [batches, setBatches] = useState(initialBatches)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<BatchDetail | null>(null)

  const [locationId, setLocationId] = useState(locations[0]?.id ?? "")
  const [planId, setPlanId] = useState("")
  const [count, setCount] = useState("20")
  const [requestId, setRequestId] = useState(newRequestId)
  const [busy, setBusy] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmVoidAll, setConfirmVoidAll] = useState(false)

  const [format, setFormat] = useState(initialFormat)

  const base = `${tenantBasePath(tenantSlug)}/admin`
  const locationPlans = useMemo(
    () => plans.filter((p) => p.locationId === locationId),
    [plans, locationId]
  )
  // Derived rather than synced in an effect: switching location falls back
  // to that location's first plan until the owner picks another.
  const effectivePlanId = locationPlans.some((p) => p.id === planId)
    ? planId
    : locationPlans[0]?.id ?? ""

  const maxThisBatch =
    quota.available === null ? limits.maxBatchSize : Math.min(limits.maxBatchSize, quota.available)

  const refreshSummary = useCallback(async () => {
    const [q, b] = await Promise.all([
      apiClient.get("/api/admin/voucher-generation") as unknown as Promise<{
        data: { quota: GenerationQuotaView }
      }>,
      apiClient.get("/api/admin/voucher-batches") as unknown as Promise<{ data: BatchSummary[] }>,
    ])
    setQuota(q.data.quota)
    setBatches(b.data)
  }, [])

  const loadDetail = useCallback(async (id: string) => {
    const res = (await apiClient.get(`/api/admin/voucher-batches/${id}`)) as unknown as {
      data: BatchDetail
    }
    setDetail(res.data)
    return res.data
  }, [])

  // While a batch is going onto the router, watch it land. The poll is also
  // what restarts a run whose process died (see the batch route).
  useEffect(() => {
    if (!selectedId) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      try {
        const d = await loadDetail(selectedId)
        if (stopped) return
        if (d.state === "minting") {
          timer = setTimeout(tick, 2500)
        } else {
          await refreshSummary()
        }
      } catch (error) {
        if (!stopped) {
          toast.add({
            title: "Couldn't load the batch",
            description: error instanceof Error ? error.message : undefined,
            type: "error",
          })
        }
      }
    }
    tick()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }, [selectedId, loadDetail, refreshSummary])

  const generate = async () => {
    setFormError(null)
    const n = Math.round(Number(count))
    if (!locationId || !effectivePlanId) return setFormError("Choose a location and a plan.")
    if (!Number.isFinite(n) || n < 1) return setFormError("Generate at least one code.")
    if (n > maxThisBatch) return setFormError(`You can generate up to ${maxThisBatch} codes right now.`)

    setBusy("generate")
    try {
      const res = (await apiClient.post("/api/admin/voucher-batches", {
        locationId,
        planId: effectivePlanId,
        count: n,
        requestId,
      })) as unknown as { data: { batchId: string } }
      setRequestId(newRequestId())
      setSelectedId(res.data.batchId)
      await refreshSummary()
      toast.add({ title: `Generating ${n} codes`, type: "success" })
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Couldn't generate codes.")
    } finally {
      setBusy(null)
    }
  }

  const voidCodes = async (body: { all: true } | { usernames: string[] }, key: string) => {
    if (!detail) return
    setBusy(key)
    try {
      const res = (await apiClient.post(`/api/admin/voucher-batches/${detail.id}/void`, body)) as unknown as {
        data: { voided: number; skipped: number; error: string | null }
      }
      const { voided, skipped, error } = res.data
      toast.add({
        title: `${voided} code${voided === 1 ? "" : "s"} voided`,
        description: error
          ? `Stopped early: ${error}`
          : skipped > 0
            ? `${skipped} skipped because someone already used them.`
            : undefined,
        type: error ? "error" : "success",
      })
      await loadDetail(detail.id)
      await refreshSummary()
    } catch (error) {
      toast.add({
        title: "Couldn't void codes",
        description: error instanceof Error ? error.message : undefined,
        type: "error",
      })
    } finally {
      setBusy(null)
      setConfirmVoidAll(false)
    }
  }

  const saveFormat = async () => {
    setBusy("format")
    try {
      await apiClient.patch("/api/admin/voucher-generation", format)
      toast.add({ title: "Code format saved", description: "Applies to batches you generate from now on.", type: "success" })
    } catch (error) {
      toast.add({
        title: "Couldn't save the format",
        description: error instanceof Error ? error.message : undefined,
        type: "error",
      })
    } finally {
      setBusy(null)
    }
  }

  const bits = codeSpaceBits(format)
  const formatProblem =
    format.length < 8 || format.length > 12
      ? "Codes are 8 to 12 characters."
      : format.charset === "digits" && format.length < 10
        ? "Digit-only codes need at least 10 digits."
        : !/^[A-Z0-9]{0,4}$/.test(format.prefix)
          ? "The prefix is up to 4 capital letters or digits."
          : null
  const sample = useMemo(() => {
    const chars = { alnum: "K7QM", letters: "KQMR", digits: "4729" }[format.charset]
    const body = chars.repeat(4).slice(0, format.length)
    return `${format.prefix}${body}`
  }, [format])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Generate codes"
        description="Print voucher codes to sell for cash. They work on your router as soon as they are generated."
      />

      {!entitled && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Generating codes is part of the Voucher Generation addon.{" "}
            <Link href={`${base}/addons`} className="font-medium underline">
              Add it from the Addons page
            </Link>
            . Codes you already generated keep working, and you can still export or void them.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          title="Plan codes this cycle"
          icon={Ticket}
          value={
            quota.allowance === null
              ? "Unlimited"
              : `${Math.max(0, quota.allowance - quota.usedThisCycle)} of ${quota.allowance} left`
          }
          description={`Resets ${formatDate(quota.cycleEnd)}`}
        />
        <StatCard
          title="Top-up credits"
          icon={Coins}
          value={String(quota.credits)}
          description="Used after your plan's codes. They don't expire."
        />
        <StatCard
          title="You can generate"
          icon={Layers}
          value={quota.available === null ? "Unlimited" : String(quota.available)}
          description={`Up to ${limits.maxBatchSize} in one batch`}
        />
      </div>

      {canEdit && entitled && (
        <SurfaceCard>
          <SurfaceCardHeader>
            <SurfaceCardTitle>New batch</SurfaceCardTitle>
            <SurfaceCardDescription>
              Each code is a login for one plan at one location, created on that location&apos;s
              router now. Its time starts when someone first logs in with it.
            </SurfaceCardDescription>
          </SurfaceCardHeader>
          <SurfaceCardContent className="space-y-4">
            {locations.length === 0 ? (
              <p className="text-sm text-muted-foreground">Add a location with a router first.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-[1fr_1fr_8rem]">
                <div className="space-y-1">
                  <Label htmlFor="gen-location">Location</Label>
                  <Select
                    value={locationId}
                    onValueChange={(value) => setLocationId(value || "")}
                    items={Object.fromEntries(locations.map((l) => [l.id, l.name]))}
                  >
                    <SelectTrigger id="gen-location" className="w-full">
                      <SelectValue placeholder="Select a location" />
                    </SelectTrigger>
                    <SelectContent>
                      {locations.map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="gen-plan">Plan</Label>
                  <Select
                    value={effectivePlanId}
                    onValueChange={(value) => setPlanId(value || "")}
                    disabled={locationPlans.length === 0}
                    items={Object.fromEntries(
                      locationPlans.map((p) => [p.id, `${p.name} (${formatNaira(p.price)})`])
                    )}
                  >
                    <SelectTrigger id="gen-plan" className="w-full">
                      <SelectValue
                        placeholder={
                          locationPlans.length === 0 ? "No active plans here" : "Select a plan"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {locationPlans.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name} ({formatNaira(p.price)})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="gen-count">How many</Label>
                  <Input
                    id="gen-count"
                    type="number"
                    min={1}
                    max={maxThisBatch}
                    value={count}
                    onChange={(e) => setCount(e.target.value)}
                  />
                </div>
              </div>
            )}
            {formError && <p className="text-sm text-destructive">{formError}</p>}
            <Button
              onClick={generate}
              disabled={busy !== null || !effectivePlanId || maxThisBatch < 1}
            >
              {busy === "generate" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Generate codes
            </Button>
            {maxThisBatch < 1 && (
              <p className="text-xs text-muted-foreground">
                You have no codes left this cycle. Contact us for top-up credits.
              </p>
            )}
          </SurfaceCardContent>
        </SurfaceCard>
      )}

      {detail && selectedId === detail.id && (
        <SurfaceCard>
          <SurfaceCardHeader>
            <SurfaceCardTitle>
              {detail.planName} at {detail.locationName}
            </SurfaceCardTitle>
            <SurfaceCardDescription>
              {detail.count} codes, generated {formatDate(detail.createdAt)}.{" "}
              {detail.counts.unused} unused, {detail.counts.active} used
              {detail.counts.void > 0 && `, ${detail.counts.void} void`}
              {detail.counts.failed > 0 && `, ${detail.counts.failed} failed (not charged)`}.
            </SurfaceCardDescription>
          </SurfaceCardHeader>
          <SurfaceCardContent className="space-y-4">
            {detail.state === "minting" && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Putting codes on the router: {detail.count - detail.counts.pending} of {detail.count} done.
                You can leave this page; it carries on.
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <SystemButton
                tone="raised"
                scale="sm"
                onClick={() => printSheet(detail, businessName)}
                disabled={printable(detail).length === 0}
              >
                <Printer />
                Print unused codes
              </SystemButton>
              <SystemButton tone="raised" scale="sm" onClick={() => downloadCsv(detail)}>
                <Download />
                Download CSV
              </SystemButton>
              {canEdit && detail.state !== "minting" && detail.counts.unused > 0 && (
                confirmVoidAll ? (
                  <>
                    <SystemButton
                      tone="action"
                      scale="sm"
                      onClick={() => voidCodes({ all: true }, "void-all")}
                      disabled={busy !== null}
                    >
                      {busy === "void-all" ? <Loader2 className="animate-spin" /> : <Ban />}
                      Confirm: void {detail.counts.unused} unused codes
                    </SystemButton>
                    <SystemButton
                      tone="ghost"
                      scale="sm"
                      onClick={() => setConfirmVoidAll(false)}
                      disabled={busy !== null}
                    >
                      Cancel
                    </SystemButton>
                  </>
                ) : (
                  <SystemButton tone="action" scale="sm" onClick={() => setConfirmVoidAll(true)}>
                    <Ban />
                    Void all unused
                  </SystemButton>
                )
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Voiding removes a code from your router so it can no longer be used. It does not
              give the code back to your allowance.
            </p>
            <div className="max-h-[28rem] overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Username</TableHead>
                    <TableHead>Password</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.codes.map((c) => (
                    <TableRow key={c.username}>
                      <TableCell className="font-mono">{c.username}</TableCell>
                      <TableCell className="font-mono">{c.password}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            c.status === "failed"
                              ? "destructive"
                              : c.status === "unused"
                                ? "default"
                                : "secondary"
                          }
                        >
                          {CODE_STATUS_LABEL[c.status]}
                        </Badge>
                        {c.error && <span className="ml-2 text-xs text-muted-foreground">{c.error}</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        {/* Failed and void codes are not logins any more:
                            nothing to copy, share or withdraw. */}
                        {(c.status === "unused" || c.status === "active") && (
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <SystemButton tone="ghost" scale="icon-sm">
                                  {busy === `void:${c.username}` ? (
                                    <Loader2 className="animate-spin" />
                                  ) : (
                                    <MoreHorizontal />
                                  )}
                                  <span className="sr-only">Open menu</span>
                                </SystemButton>
                              }
                            />
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => copyCode(detail, c, businessName)}>
                                <Copy className="mr-2 h-4 w-4" />
                                Copy code
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => shareOnWhatsApp(detail, c, businessName)}>
                                <MessageCircle className="mr-2 h-4 w-4" />
                                Share on WhatsApp
                              </DropdownMenuItem>
                              {canEdit && c.status === "unused" && detail.state !== "minting" && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    variant="destructive"
                                    disabled={busy !== null}
                                    onClick={() => voidCodes({ usernames: [c.username] }, `void:${c.username}`)}
                                  >
                                    <Ban className="mr-2 h-4 w-4" />
                                    Void code
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </SurfaceCardContent>
        </SurfaceCard>
      )}

      <SurfaceCard>
        <SurfaceCardHeader>
          <SurfaceCardTitle>Batches</SurfaceCardTitle>
          <SurfaceCardDescription>
            A used code also appears under Vouchers from its first login, marked as a generated code.
          </SurfaceCardDescription>
        </SurfaceCardHeader>
        <SurfaceCardContent>
          {batches.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Ticket />
                </EmptyMedia>
                <EmptyTitle>No codes generated yet</EmptyTitle>
                <EmptyDescription>Batches you generate show up here.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Generated</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Codes</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(b.createdAt)}</TableCell>
                    <TableCell>{b.planName}</TableCell>
                    <TableCell>{b.locationName}</TableCell>
                    <TableCell className="text-sm">
                      {b.count} ({b.counts.unused} unused, {b.counts.active} used)
                    </TableCell>
                    <TableCell>
                      <Badge variant={b.state === "failed" ? "destructive" : b.state === "ready" ? "default" : "secondary"}>
                        {STATE_LABEL[b.state]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <SystemButton tone="ghost" scale="icon-sm">
                              <MoreHorizontal />
                              <span className="sr-only">Open menu</span>
                            </SystemButton>
                          }
                        />
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => {
                              setConfirmVoidAll(false)
                              setSelectedId(b.id)
                            }}
                          >
                            <Eye className="mr-2 h-4 w-4" />
                            View codes
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SurfaceCardContent>
      </SurfaceCard>

      <SurfaceCard>
        <SurfaceCardHeader>
          <SurfaceCardTitle>Code format</SurfaceCardTitle>
          <SurfaceCardDescription>
            How new codes look. Codes already generated keep their format.
          </SurfaceCardDescription>
        </SurfaceCardHeader>
        <SurfaceCardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="fmt-length">Length</Label>
              <Input
                id="fmt-length"
                type="number"
                min={8}
                max={12}
                value={format.length}
                disabled={!canEdit}
                onChange={(e) => setFormat((f) => ({ ...f, length: Math.round(Number(e.target.value || 0)) }))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fmt-charset">Characters</Label>
              <Select
                value={format.charset}
                disabled={!canEdit}
                items={CHARSET_LABELS}
                onValueChange={(value) => {
                  if (value) setFormat((f) => ({ ...f, charset: value as GeneratedCodeFormat["charset"] }))
                }}
              >
                <SelectTrigger id="fmt-charset" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(CHARSET_LABELS) as GeneratedCodeFormat["charset"][]).map((key) => (
                    <SelectItem key={key} value={key}>
                      {CHARSET_LABELS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="fmt-prefix">Prefix (optional)</Label>
              <Input
                id="fmt-prefix"
                maxLength={4}
                value={format.prefix}
                disabled={!canEdit}
                onChange={(e) => setFormat((f) => ({ ...f, prefix: e.target.value.toUpperCase() }))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fmt-password">Password</Label>
              <Select
                value={format.passwordMode}
                disabled={!canEdit}
                items={PASSWORD_LABELS}
                onValueChange={(value) => {
                  if (value)
                    setFormat((f) => ({ ...f, passwordMode: value as GeneratedCodeFormat["passwordMode"] }))
                }}
              >
                <SelectTrigger id="fmt-password" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PASSWORD_LABELS) as GeneratedCodeFormat["passwordMode"][]).map((key) => (
                    <SelectItem key={key} value={key}>
                      {PASSWORD_LABELS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Looks like <span className="font-mono font-medium text-foreground">{sample}</span>.
            Similar-looking characters (0 and O, 1 and I) are never used. Your router does not
            lock anyone out after wrong guesses, so longer codes are safer
            {bits < 40 ? ": consider a longer code or a separate password." : "."}
          </p>
          {formatProblem && <p className="text-sm text-destructive">{formatProblem}</p>}
          {canEdit && (
            <Button variant="outline" onClick={saveFormat} disabled={busy !== null || formatProblem !== null}>
              {busy === "format" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save format
            </Button>
          )}
        </SurfaceCardContent>
      </SurfaceCard>
    </div>
  )
}
