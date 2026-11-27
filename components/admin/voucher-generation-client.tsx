"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  AlertCircle,
  Ban,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Coins,
  Copy,
  Download,
  Layers,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Package,
  Printer,
  Ticket,
} from "lucide-react"

import type { BatchDetail, GenerationQuotaView } from "@/lib/voucher-generation"
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/system/dropdown-menu"
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
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardFooter,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card"
import { StatCard } from "@/components/system/stat-card"
import { BuyCreditsDialog } from "@/components/admin/buy-credits-dialog"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/system/empty-state"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
  limits: {
    maxBatchSize: number
    maxUnusedPerRouter: number
    /** Kobo per top-up credit online; 0 is not on sale. */
    creditPriceKobo: number
    minCreditPurchase: number
  }
  /** The most credits one online purchase may buy. */
  maxCreditPurchase: number
  initialBatches: BatchDetail[]
  locations: Array<{ id: string; name: string }>
  plans: PlanOption[]
}

type CodeStatus = BatchDetail["codes"][number]["status"]

/** One row of the codes table: a code, and the batch it came from. */
interface CodeRow {
  username: string
  password: string
  status: CodeStatus
  error: string | null
  batch: BatchDetail
}

const PAGE_SIZE = 50

const CODE_STATUS_LABEL: Record<CodeStatus, string> = {
  pending: "Waiting",
  unused: "Unused",
  active: "Used",
  void: "Void",
  failed: "Failed",
}

const STATUS_OPTIONS = [
  { value: "all", label: "All status" },
  { value: "unused", label: "Unused" },
  { value: "active", label: "Used" },
  { value: "void", label: "Void" },
  { value: "failed", label: "Failed" },
] as const

const CHARSET_OPTIONS: Array<{ value: GeneratedCodeFormat["charset"]; label: string }> = [
  { value: "alnum", label: "Letters and digits" },
  { value: "letters", label: "Letters only" },
  { value: "digits", label: "Digits only" },
]

const PASSWORD_OPTIONS: Array<{ value: GeneratedCodeFormat["passwordMode"]; label: string }> = [
  { value: "same", label: "Same as the code" },
  { value: "separate", label: "Separate password" },
]

function newRequestId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function batchLabel(batch: BatchDetail): string {
  return `${batch.planName}, ${batch.locationName}, ${formatDate(batch.createdAt)} (${batch.count})`
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

function planLine(batch: BatchDetail): string {
  return [batch.planName, batch.plan.duration, batch.plan.dataLimit].filter(Boolean).join(", ")
}

/**
 * What a customer needs to log in, as one message: for the clipboard and
 * for WhatsApp alike, so the two never say different things.
 */
function codeMessage(row: CodeRow, businessName: string): string {
  const login =
    row.username === row.password
      ? `Code: ${row.username}`
      : `Username: ${row.username}\nPassword: ${row.password}`
  return `${businessName} WiFi\n${planLine(row.batch)}\n${login}`
}

async function copyCode(row: CodeRow, businessName: string) {
  const ok = await copyTextToClipboard(codeMessage(row, businessName))
  toast.add(
    ok
      ? { title: "Copied", description: row.username, type: "success" }
      : { title: "Couldn't copy", description: "Your browser blocked the clipboard.", type: "error" }
  )
}

/** Opens WhatsApp with the message ready; the owner picks who it goes to. */
function shareOnWhatsApp(row: CodeRow, businessName: string) {
  const url = `https://wa.me/?text=${encodeURIComponent(codeMessage(row, businessName))}`
  window.open(url, "_blank", "noopener,noreferrer")
}

function downloadCsv(rows: CodeRow[]) {
  const lines = [
    ["username", "password", "plan", "location", "generated", "status"],
    ...rows.map((r) => [
      r.username,
      r.password,
      r.batch.planName,
      r.batch.locationName,
      formatDate(r.batch.createdAt),
      CODE_STATUS_LABEL[r.status],
    ]),
  ]
  const blob = new Blob([lines.map((l) => l.map(csvCell).join(",")).join("\n")], {
    type: "text/csv;charset=utf-8",
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `voucher-codes-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

/** A sheet of cut-out cards, one per code, in a new tab to print. */
function printSheet(rows: CodeRow[], businessName: string) {
  const cards = rows
    .map((r) => {
      const login =
        r.username === r.password
          ? `<div class="label">Code</div><div class="code">${escapeHtml(r.username)}</div>`
          : `<div class="label">Username</div><div class="code">${escapeHtml(r.username)}</div>
  <div class="label">Password</div><div class="code">${escapeHtml(r.password)}</div>`
      return `<div class="card">
  <div class="biz">${escapeHtml(businessName)}</div>
  <div class="plan">${escapeHtml(planLine(r.batch))}</div>
  ${login}
</div>`
    })
    .join("\n")
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Voucher codes</title>
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

/**
 * A form-row dropdown standing in for a select: the `field` tone the
 * platform's dialogs use (addon dialog, billing-plan dialog), so it sits
 * beside an input as one kind of thing.
 */
function FieldDropdown<T extends string>({
  id,
  value,
  options,
  onChange,
  disabled,
  placeholder,
}: {
  id?: string
  value: T | ""
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (value: T) => void
  disabled?: boolean
  placeholder?: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        id={id}
        render={<SystemButton tone="field" scale="sm" />}
        className="w-full justify-between"
        disabled={disabled}
      >
        <span className="truncate">
          {options.find((o) => o.value === value)?.label ?? placeholder ?? "Select"}
        </span>
        <ChevronDown />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => v && onChange(v as T)}>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value}>
              {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type VoidTarget = { kind: "code"; row: CodeRow } | { kind: "batch"; batch: BatchDetail } | null

export function VoucherGenerationClient({
  tenantSlug,
  businessName,
  canEdit,
  entitled,
  initialQuota,
  initialFormat,
  limits,
  maxCreditPurchase,
  initialBatches,
  locations,
  plans,
}: VoucherGenerationClientProps) {
  const [quota, setQuota] = useState(initialQuota)
  const [buyingCredits, setBuyingCredits] = useState(false)
  // Credits are bought here once a superadmin has priced them; until then
  // the page keeps saying to ask, which is how top-ups were sold before.
  const canBuyCredits = canEdit && entitled && limits.creditPriceKobo > 0
  const [batches, setBatches] = useState(initialBatches)

  const [batchFilter, setBatchFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [pageIndex, setPageIndex] = useState(0)

  const [locationId, setLocationId] = useState(locations[0]?.id ?? "")
  const [planId, setPlanId] = useState("")
  // 1, not a batch: a mistyped generate costs quota that is never given back.
  const [count, setCount] = useState("1")
  const [requestId, setRequestId] = useState(newRequestId)
  const [busy, setBusy] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [voidTarget, setVoidTarget] = useState<VoidTarget>(null)

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

  /* ------------------------------------------------------------- rows */

  const selectedBatch = batches.find((b) => b.id === batchFilter) ?? null
  const rows = useMemo<CodeRow[]>(() => {
    const scope = selectedBatch ? [selectedBatch] : batches
    return scope.flatMap((batch) =>
      batch.codes
        .filter((c) => statusFilter === "all" || c.status === statusFilter)
        .map((c) => ({ username: c.username, password: c.password, status: c.status, error: c.error, batch }))
    )
  }, [batches, selectedBatch, statusFilter])
  const pageRows = rows.slice(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE)
  const unusedRows = rows.filter((r) => r.status === "unused")
  const minting = batches.filter((b) => b.state === "minting")

  /* ---------------------------------------------------------- loading */

  const refresh = useCallback(async () => {
    const [q, b] = await Promise.all([
      apiClient.get("/api/admin/voucher-generation") as unknown as Promise<{
        data: { quota: GenerationQuotaView }
      }>,
      apiClient.get("/api/admin/voucher-batches") as unknown as Promise<{ data: BatchDetail[] }>,
    ])
    setQuota(q.data.quota)
    setBatches(b.data)
  }, [])

  // While any batch is going onto the router, watch it land. The poll is
  // also what restarts a run whose process died (see the batch route).
  const mintingKey = minting.map((b) => b.id).join(",")
  useEffect(() => {
    if (!mintingKey) return
    let stopped = false
    const timer = setInterval(async () => {
      try {
        const updates = await Promise.all(
          mintingKey.split(",").map(
            (id) =>
              apiClient.get(`/api/admin/voucher-batches/${id}`) as unknown as Promise<{ data: BatchDetail }>
          )
        )
        if (stopped) return
        setBatches((prev) => prev.map((b) => updates.find((u) => u.data.id === b.id)?.data ?? b))
        if (updates.every((u) => u.data.state !== "minting")) {
          const q = (await apiClient.get("/api/admin/voucher-generation")) as unknown as {
            data: { quota: GenerationQuotaView }
          }
          if (!stopped) setQuota(q.data.quota)
        }
      } catch {
        // The next tick tries again; a failed poll changes nothing.
      }
    }, 2500)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [mintingKey])

  /* ---------------------------------------------------------- actions */

  const generate = async () => {
    setFormError(null)
    const n = Math.round(Number(count))
    if (!locationId || !effectivePlanId) return setFormError("Choose a location and a plan.")
    if (!Number.isFinite(n) || n < 1) return setFormError("Generate at least one code.")
    if (n > maxThisBatch) return setFormError(`You can generate up to ${maxThisBatch} codes right now.`)

    setBusy("generate")
    try {
      await apiClient.post("/api/admin/voucher-batches", {
        locationId,
        planId: effectivePlanId,
        count: n,
        requestId,
      })
      setRequestId(newRequestId())
      await refresh()
      setBatchFilter("all")
      setStatusFilter("all")
      setPageIndex(0)
      toast.add({ title: `Generating ${n} codes`, type: "success" })
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Couldn't generate codes.")
    } finally {
      setBusy(null)
    }
  }

  const confirmVoid = async () => {
    if (!voidTarget) return
    const batchId = voidTarget.kind === "code" ? voidTarget.row.batch.id : voidTarget.batch.id
    const body = voidTarget.kind === "code" ? { usernames: [voidTarget.row.username] } : { all: true }
    setBusy("void")
    try {
      const res = (await apiClient.post(`/api/admin/voucher-batches/${batchId}/void`, body)) as unknown as {
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
      await refresh()
    } catch (error) {
      toast.add({
        title: "Couldn't void",
        description: error instanceof Error ? error.message : undefined,
        type: "error",
      })
    } finally {
      setBusy(null)
      setVoidTarget(null)
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
    format.length < 6 || format.length > 12
      ? "Codes are 6 to 12 characters."
      : format.charset === "digits" && format.length < 10
        ? "Digit-only codes need at least 10 digits."
        : !/^[A-Z0-9]{0,4}$/.test(format.prefix)
          ? "The prefix is up to 4 capital letters or digits."
          : null
  const sample = useMemo(() => {
    const chars = { alnum: "K7QM", letters: "KQMR", digits: "4729" }[format.charset]
    return `${format.prefix}${chars.repeat(4).slice(0, format.length)}`
  }, [format])

  const batchOptions = [
    { value: "all", label: "All batches" },
    ...batches.map((b) => ({ value: b.id, label: batchLabel(b) })),
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Generate codes"
        description="Print voucher codes to sell for cash. They work on your router as soon as they are generated."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<SystemButton tone="raised" scale="sm" />}
                className="w-56 shrink-0 justify-between"
              >
                <span className="truncate">
                  {batchOptions.find((o) => o.value === batchFilter)?.label ?? "All batches"}
                </span>
                <ChevronDown />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuRadioGroup
                  value={batchFilter}
                  onValueChange={(value) => {
                    setBatchFilter(value || "all")
                    setPageIndex(0)
                  }}
                >
                  {batchOptions.map((o) => (
                    <DropdownMenuRadioItem key={o.value} value={o.value}>
                      {o.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger
                render={<SystemButton tone="raised" scale="sm" />}
                className="w-40 shrink-0 justify-between"
              >
                {STATUS_OPTIONS.find((o) => o.value === statusFilter)?.label ?? "All status"}
                <ChevronDown />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuRadioGroup
                  value={statusFilter}
                  onValueChange={(value) => {
                    setStatusFilter(value || "all")
                    setPageIndex(0)
                  }}
                >
                  {STATUS_OPTIONS.map((o) => (
                    <DropdownMenuRadioItem key={o.value} value={o.value}>
                      {o.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      {!entitled && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Generating codes is part of the Voucher Generation addon.{" "}
            <Link href={`${base}/addons`} className="font-medium underline">
              Add it from the Addons page
            </Link>
            . Codes you already generated keep working, and you can still share, export or void them.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
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
          action={canBuyCredits ? { label: "Buy credits", onClick: () => setBuyingCredits(true) } : undefined}
          value={String(quota.credits)}
          description="Used after your plan's codes. They don't expire."
        />
        <StatCard
          title="You can generate"
          icon={Layers}
          value={quota.available === null ? "Unlimited" : String(quota.available)}
          description={`Up to ${limits.maxBatchSize} in one batch`}
        />
        {/* Stock, not revenue: a code counts as sold on the dashboard at
            first use. Valued at each batch's price, the price on the card. */}
        <StatCard
          title="Unused codes"
          icon={Package}
          value={String(quota.stock.unused)}
          description={
            quota.stock.unused > 0
              ? `Worth ${formatNaira(quota.stock.valueKobo)} when sold`
              : "Codes nobody has logged in with yet"
          }
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
                <div className="space-y-1.5">
                  <Label htmlFor="gen-location">Location</Label>
                  <FieldDropdown
                    id="gen-location"
                    value={locationId}
                    options={locations.map((l) => ({ value: l.id, label: l.name }))}
                    onChange={setLocationId}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="gen-plan">Plan</Label>
                  <FieldDropdown
                    id="gen-plan"
                    value={effectivePlanId}
                    options={locationPlans.map((p) => ({
                      value: p.id,
                      label: `${p.name} (${formatNaira(p.price)})`,
                    }))}
                    onChange={setPlanId}
                    disabled={locationPlans.length === 0}
                    placeholder="No active plans here"
                  />
                </div>
                <div className="space-y-1.5">
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
            {maxThisBatch < 1 && (
              <p className="text-xs text-muted-foreground">
                {canBuyCredits
                  ? "You have no codes left this cycle. Buy top-up credits above to keep generating."
                  : "You have no codes left this cycle. Contact us for top-up credits."}
              </p>
            )}
          </SurfaceCardContent>
          <SurfaceCardFooter variant="toolbar">
            <span />
            <SystemButton
              tone="field"
              scale="sm"
              onClick={generate}
              disabled={busy !== null || !effectivePlanId || maxThisBatch < 1}
            >
              {busy === "generate" && <Loader2 className="animate-spin" />}
              Generate codes
            </SystemButton>
          </SurfaceCardFooter>
        </SurfaceCard>
      )}

      <SurfaceCard
        action={
          <div className="flex flex-wrap items-center gap-2">
            <SystemButton
              tone="raised"
              scale="sm"
              onClick={() => printSheet(unusedRows, businessName)}
              disabled={unusedRows.length === 0}
            >
              <Printer />
              Print unused
            </SystemButton>
            <SystemButton tone="raised" scale="sm" onClick={() => downloadCsv(rows)} disabled={rows.length === 0}>
              <Download />
              CSV
            </SystemButton>
            {canEdit && selectedBatch && selectedBatch.state !== "minting" && selectedBatch.counts.unused > 0 && (
              <SystemButton
                tone="action"
                scale="sm"
                onClick={() => setVoidTarget({ kind: "batch", batch: selectedBatch })}
              >
                <Ban />
                Void all unused
              </SystemButton>
            )}
          </div>
        }
      >
        <SurfaceCardHeader>
          <SurfaceCardTitle>Codes</SurfaceCardTitle>
          <SurfaceCardDescription>
            Newest first. A used code also appears under Vouchers from its first login.
          </SurfaceCardDescription>
        </SurfaceCardHeader>
        <SurfaceCardContent inset={false}>
          {minting.length > 0 && (
            <div className="flex items-center gap-2 px-5 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Putting codes on the router:{" "}
              {minting.map((b) => `${b.count - b.counts.pending} of ${b.count}`).join(", ")} done. You
              can leave this page; it carries on.
            </div>
          )}
          {rows.length === 0 ? (
            batches.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Ticket />
                  </EmptyMedia>
                  <EmptyTitle>No codes generated yet</EmptyTitle>
                  <EmptyDescription>Codes you generate show up here.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No codes match this filter.
              </div>
            )
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Generated</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Password</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((row) => (
                  <TableRow key={`${row.batch.id}:${row.username}`}>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(row.batch.createdAt)}
                    </TableCell>
                    <TableCell>{row.batch.planName}</TableCell>
                    <TableCell>{row.batch.locationName}</TableCell>
                    <TableCell>
                      <code className="text-xs">{row.username}</code>
                    </TableCell>
                    <TableCell>
                      <code className="text-xs">{row.password}</code>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          row.status === "failed"
                            ? "destructive"
                            : row.status === "unused"
                              ? "default"
                              : "secondary"
                        }
                      >
                        {CODE_STATUS_LABEL[row.status]}
                      </Badge>
                      {row.error && <span className="ml-2 text-xs text-muted-foreground">{row.error}</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {/* Failed, void and waiting codes are not logins:
                          nothing to copy, share or withdraw. */}
                      {(row.status === "unused" || row.status === "active") && (
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
                            <DropdownMenuItem onClick={() => copyCode(row, businessName)}>
                              <Copy className="mr-2 h-4 w-4" />
                              Copy code
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => shareOnWhatsApp(row, businessName)}>
                              <MessageCircle className="mr-2 h-4 w-4" />
                              Share on WhatsApp
                            </DropdownMenuItem>
                            {canEdit && row.status === "unused" && row.batch.state !== "minting" && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={() => setVoidTarget({ kind: "code", row })}
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
          )}
        </SurfaceCardContent>

        {rows.length > PAGE_SIZE && (
          <SurfaceCardFooter variant="toolbar">
            <span className="text-sm text-muted-foreground">
              {pageIndex * PAGE_SIZE + 1}-{Math.min(rows.length, (pageIndex + 1) * PAGE_SIZE)} of {rows.length}
            </span>
            <div className="flex items-center gap-1 rounded-full bg-sunken p-1">
              <SystemButton
                tone="raised"
                scale="sm"
                onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
                disabled={pageIndex === 0}
                aria-label="Previous page"
              >
                <ChevronLeft />
                <span className="max-sm:sr-only">Previous</span>
              </SystemButton>
              <SystemButton
                tone="raised"
                scale="sm"
                onClick={() => setPageIndex((i) => i + 1)}
                disabled={(pageIndex + 1) * PAGE_SIZE >= rows.length}
                aria-label="Next page"
              >
                <span className="max-sm:sr-only">Next</span>
                <ChevronRight />
              </SystemButton>
            </div>
          </SurfaceCardFooter>
        )}
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
            <div className="space-y-1.5">
              <Label htmlFor="fmt-length">Length</Label>
              <Input
                id="fmt-length"
                type="number"
                min={6}
                max={12}
                value={format.length}
                disabled={!canEdit}
                onChange={(e) => setFormat((f) => ({ ...f, length: Math.round(Number(e.target.value || 0)) }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fmt-charset">Characters</Label>
              <FieldDropdown
                id="fmt-charset"
                value={format.charset}
                options={CHARSET_OPTIONS}
                disabled={!canEdit}
                onChange={(charset) => setFormat((f) => ({ ...f, charset }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fmt-prefix">Prefix (optional)</Label>
              <Input
                id="fmt-prefix"
                maxLength={4}
                value={format.prefix}
                disabled={!canEdit}
                onChange={(e) => setFormat((f) => ({ ...f, prefix: e.target.value.toUpperCase() }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fmt-password">Password</Label>
              <FieldDropdown
                id="fmt-password"
                value={format.passwordMode}
                options={PASSWORD_OPTIONS}
                disabled={!canEdit}
                onChange={(passwordMode) => setFormat((f) => ({ ...f, passwordMode }))}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Looks like <span className="font-mono font-medium text-foreground">{sample}</span>.
            Similar-looking characters (0 and O, 1 and I) are never used. Your router does not
            lock anyone out after wrong guesses, so longer codes are safer
            {bits < 40 ? ": consider a longer code or a separate password." : "."}
          </p>
          {formatProblem && <p className="text-sm text-destructive">{formatProblem}</p>}
        </SurfaceCardContent>
        {canEdit && (
          <SurfaceCardFooter variant="toolbar">
            <span />
            <SystemButton
              tone="field"
              scale="sm"
              onClick={saveFormat}
              disabled={busy !== null || formatProblem !== null}
            >
              {busy === "format" ? "Saving..." : "Save"}
            </SystemButton>
          </SurfaceCardFooter>
        )}
      </SurfaceCard>

      <AlertDialog open={voidTarget !== null} onOpenChange={(open) => !open && setVoidTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {voidTarget?.kind === "batch"
                ? `Void ${voidTarget.batch.counts.unused} unused codes`
                : "Void code"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {voidTarget?.kind === "batch"
                ? `Every unused code in the ${voidTarget.batch.planName} batch from ${formatDate(voidTarget.batch.createdAt)} is removed from your router and can no longer be used.`
                : `${voidTarget?.kind === "code" ? voidTarget.row.username : ""} is removed from your router and can no longer be used.`}{" "}
              Codes someone has already used are left alone. Voided codes are not given back to
              your allowance.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === "void"}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmVoid} disabled={busy === "void"} variant="destructive">
              {busy === "void" ? "Voiding..." : "Void"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {canBuyCredits && (
        <BuyCreditsDialog
          open={buyingCredits}
          onOpenChange={setBuyingCredits}
          priceKobo={limits.creditPriceKobo}
          minCredits={limits.minCreditPurchase}
          maxCredits={maxCreditPurchase}
        />
      )}
    </div>
  )
}
