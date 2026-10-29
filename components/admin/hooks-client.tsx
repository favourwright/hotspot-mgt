"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { AlertCircle, Loader2, Plus, ShieldCheck, Webhook } from "lucide-react"

import { apiClient } from "@/lib/api-client"
import { tenantHref } from "@/lib/tenant-url"
import { formatDate } from "@/lib/utils"
import type { DecisionHookView } from "@/lib/decision-hooks"
import type { FailStrategy } from "@/lib/decision-hook-contract"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/system/button"
import { Button as UiButton } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { CopyButton } from "@/components/shared/copy-button"
import { ChoiceOption } from "@/components/shared/choice-option"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/system/dialog"
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
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/system/empty-state"
import { PageHeader } from "@/components/system/page-header"
import { toast } from "@/components/ui/toast"

interface Option {
  id: string
  name: string
  locationName?: string
}

interface HooksClientProps {
  tenantSlug: string
  initialHooks: DecisionHookView[]
  plans: Option[]
  locations: Option[]
  entitled: boolean
  configured: boolean
  canEdit: boolean
}

interface CallRow {
  id: string
  outcome: string
  httpStatus: number | null
  latencyMs: number
  error: string | null
  reason: string | null
  createdAt: string | null
}

interface TestResult {
  httpStatus: number | null
  latencyMs: number
  verdict: { kind: "allow" } | { kind: "block"; reason: string; code: string | null } | { kind: "invalid"; error: string }
  bodyPreview: string | null
}

interface FormState {
  name: string
  url: string
  timeoutMs: string
  failStrategy: FailStrategy | null
  planIds: string[]
  locationIds: string[]
}

const EMPTY_FORM: FormState = {
  name: "",
  url: "",
  timeoutMs: "2000",
  failStrategy: null,
  planIds: [],
  locationIds: [],
}

const OUTCOME_LABELS: Record<string, string> = {
  allowed: "Allowed",
  blocked: "Blocked",
  failed: "Failed",
  breaker_open: "Not called",
  rate_capped: "Over cap",
  test: "Test",
}

function outcomeVariant(outcome: string): "default" | "secondary" | "destructive" | "outline" {
  if (outcome === "allowed") return "default"
  if (outcome === "blocked" || outcome === "test") return "secondary"
  if (outcome === "failed" || outcome === "breaker_open" || outcome === "rate_capped") return "destructive"
  return "outline"
}

export function HooksClient({
  tenantSlug,
  initialHooks,
  plans,
  locations,
  entitled,
  configured,
  canEdit,
}: HooksClientProps) {
  const [hooks, setHooks] = useState(initialHooks)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<DecisionHookView | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<DecisionHookView | null>(null)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [calls, setCalls] = useState<CallRow[] | null>(null)

  const hook = hooks[0] ?? null
  const canChange = canEdit && entitled && configured

  const reload = async () => {
    const res = (await apiClient.get("/api/admin/hooks")) as unknown as { data: DecisionHookView[] }
    setHooks(res.data)
  }

  const loadCalls = useCallback(async (hookId: string) => {
    try {
      const res = (await apiClient.get(`/api/admin/hooks/${hookId}/calls`)) as unknown as { data: CallRow[] }
      setCalls(res.data)
    } catch {
      setCalls([])
    }
  }, [])

  // Keyed on the id, not the hook object, so a reload after an edit does
  // not refetch a log that has not changed.
  const hookId = hook?.id ?? null
  useEffect(() => {
    if (!hookId || !canEdit) return
    let cancelled = false
    ;(apiClient.get(`/api/admin/hooks/${hookId}/calls`) as unknown as Promise<{ data: CallRow[] }>)
      .then((res) => {
        if (!cancelled) setCalls(res.data)
      })
      .catch(() => {
        if (!cancelled) setCalls([])
      })
    return () => {
      cancelled = true
    }
  }, [hookId, canEdit])

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    try {
      await fn()
    } catch (error) {
      toast.add({
        title: "That didn't work",
        description: error instanceof Error ? error.message : "Try again.",
        type: "error",
      })
    } finally {
      setBusy(null)
    }
  }

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormError(null)
    setFormOpen(true)
  }

  const openEdit = (h: DecisionHookView) => {
    setEditing(h)
    setForm({
      name: h.name,
      url: h.url,
      timeoutMs: String(h.timeoutMs),
      failStrategy: h.failStrategy,
      planIds: h.planIds ?? [],
      locationIds: h.locationIds ?? [],
    })
    setFormError(null)
    setFormOpen(true)
  }

  const save = async () => {
    if (!form.failStrategy) {
      setFormError("Choose what happens when your server can't be reached.")
      return
    }
    setBusy("save")
    setFormError(null)
    try {
      const body = {
        name: form.name,
        url: form.url,
        timeoutMs: Number(form.timeoutMs) || 2000,
        failStrategy: form.failStrategy,
        planIds: form.planIds,
        locationIds: form.locationIds,
      }
      if (editing) {
        await apiClient.patch(`/api/admin/hooks/${editing.id}`, body)
        toast.add({ title: "Hook saved", type: "success" })
      } else {
        const res = (await apiClient.post("/api/admin/hooks", body)) as unknown as {
          data: { secret: string }
        }
        setSecret(res.data.secret)
      }
      setFormOpen(false)
      await reload()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not save the hook.")
    } finally {
      setBusy(null)
    }
  }

  const toggle = (h: DecisionHookView) =>
    run(`toggle:${h.id}`, async () => {
      await apiClient.patch(`/api/admin/hooks/${h.id}`, { active: !h.active })
      toast.add({ title: h.active ? "Hook switched off" : "Hook switched on", type: "success" })
      await reload()
    })

  const test = (h: DecisionHookView) =>
    run(`test:${h.id}`, async () => {
      const res = (await apiClient.post(`/api/admin/hooks/${h.id}/test`, {})) as unknown as {
        data: TestResult
      }
      setTestResult(res.data)
      await loadCalls(h.id)
    })

  const rotate = (h: DecisionHookView) =>
    run(`rotate:${h.id}`, async () => {
      const res = (await apiClient.post(`/api/admin/hooks/${h.id}/rotate-secret`, {})) as unknown as {
        data: { secret: string }
      }
      setSecret(res.data.secret)
      await reload()
    })

  const remove = (h: DecisionHookView) =>
    run(`delete:${h.id}`, async () => {
      await apiClient.delete(`/api/admin/hooks/${h.id}`)
      toast.add({ title: "Hook deleted", type: "success" })
      setCalls(null)
      setTestResult(null)
      await reload()
    })

  const toggleId = (field: "planIds" | "locationIds", id: string, on: boolean) =>
    setForm((prev) => ({
      ...prev,
      [field]: on ? [...prev[field], id] : prev[field].filter((x) => x !== id),
    }))

  const scopeLabel = (ids: string[] | null, all: string, options: Option[], noun: string) => {
    if (!ids || ids.length === 0) return all
    if (ids.length === 1) return options.find((o) => o.id === ids[0])?.name ?? `1 ${noun}`
    return `${ids.length} ${noun}s`
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Decision hooks"
        description="Before a customer pays, ask your own server whether they may buy. A no stops the purchase before any money moves."
        action={
          !hook && canChange ? (
            <Button tone="action" onClick={openCreate}>
              <Plus className="size-4" />
              New hook
            </Button>
          ) : undefined
        }
      />

      {!entitled && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Hooks are part of the API Access addon.{" "}
            <Link href={tenantHref(tenantSlug, "/admin/addons")} className="font-medium underline">
              Add it from the Addons page
            </Link>{" "}
            to create or change a hook.
            {hook ? " Your existing hook keeps running, and you can still switch it off or delete it." : ""}
          </AlertDescription>
        </Alert>
      )}
      {!configured && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Hooks aren&apos;t available on this server yet. Please contact support.
          </AlertDescription>
        </Alert>
      )}

      {!hook ? (
        <SurfaceCard>
          <SurfaceCardContent>
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Webhook />
                </EmptyMedia>
                <EmptyTitle>No hook yet</EmptyTitle>
                <EmptyDescription>
                  A hook is a URL on your own server. We send it the customer and
                  the plan, signed, and it answers yes or no. Use it for anything
                  your own system knows: membership, credit, eligibility.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </SurfaceCardContent>
        </SurfaceCard>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 md:items-start">
          <SurfaceCard>
            <SurfaceCardHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <SurfaceCardTitle>{hook.name}</SurfaceCardTitle>
                  <SurfaceCardDescription className="truncate font-mono">{hook.url}</SurfaceCardDescription>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {hook.breaker.open && <Badge variant="destructive">Failing</Badge>}
                  <Badge variant={hook.active ? "default" : "secondary"}>{hook.active ? "On" : "Off"}</Badge>
                </div>
              </div>
            </SurfaceCardHeader>
            <SurfaceCardContent className="space-y-3 text-sm">
              {hook.breaker.open && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {hook.failStrategy === "block"
                      ? "Your server keeps failing, so we've stopped calling it and sales of the plans it covers are paused. We retry every 30 seconds."
                      : "Your server keeps failing, so we've stopped calling it and purchases are going through unchecked. We retry every 30 seconds."}
                  </AlertDescription>
                </Alert>
              )}
              <Row
                label="If your server can't be reached"
                value={hook.failStrategy === "block" ? "Stop the purchase" : "Let the purchase through"}
              />
              <Row label="Waits up to" value={`${(hook.timeoutMs / 1000).toFixed(1)}s`} />
              <Row label="Plans" value={scopeLabel(hook.planIds, "All plans", plans, "plan")} />
              <Row label="Locations" value={scopeLabel(hook.locationIds, "All locations", locations, "location")} />
              {hook.rotating && (
                <p className="text-xs text-muted-foreground">
                  Signing with both your new and previous secret for 24 hours after a rotation.
                </p>
              )}

              {canEdit && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {/* Switching off needs neither API access nor a paid-up
                      account: an owner must always be able to stop a hook
                      that is pausing their own sales. */}
                  <UiButton
                    size="sm"
                    variant={hook.active ? "outline" : "default"}
                    disabled={busy !== null || (!hook.active && !canChange)}
                    onClick={() => toggle(hook)}
                  >
                    {busy === `toggle:${hook.id}` && <Loader2 className="size-4 animate-spin" />}
                    {hook.active ? "Switch off" : "Switch on"}
                  </UiButton>
                  <UiButton size="sm" variant="outline" disabled={busy !== null || !canChange} onClick={() => test(hook)}>
                    {busy === `test:${hook.id}` && <Loader2 className="size-4 animate-spin" />}
                    Send test
                  </UiButton>
                  <UiButton size="sm" variant="outline" disabled={busy !== null || !canChange} onClick={() => openEdit(hook)}>
                    Edit
                  </UiButton>
                  <UiButton size="sm" variant="outline" disabled={busy !== null || !canChange} onClick={() => rotate(hook)}>
                    {busy === `rotate:${hook.id}` && <Loader2 className="size-4 animate-spin" />}
                    New secret
                  </UiButton>
                  <UiButton size="sm" variant="destructive" disabled={busy !== null} onClick={() => setConfirmDelete(hook)}>
                    Delete
                  </UiButton>
                </div>
              )}
              {!hook.active && (
                <p className="text-xs text-muted-foreground">
                  New hooks start switched off. Send a test, check your server&apos;s answer, then switch it on.
                </p>
              )}

              {testResult && (
                <div className="space-y-2 rounded-2xl bg-muted/50 p-3">
                  <p className="font-medium">
                    {testResult.verdict.kind === "allow"
                      ? "Your server said yes"
                      : testResult.verdict.kind === "block"
                        ? "Your server said no"
                        : "That answer would count as a failure"}
                  </p>
                  <Row label="Status" value={testResult.httpStatus === null ? "No response" : String(testResult.httpStatus)} />
                  <Row label="Took" value={`${testResult.latencyMs} ms`} />
                  {testResult.verdict.kind === "block" && <Row label="Customer would see" value={testResult.verdict.reason} />}
                  {testResult.verdict.kind === "invalid" && <Row label="Why" value={testResult.verdict.error} />}
                  {testResult.bodyPreview && (
                    <pre className="max-h-40 overflow-auto rounded-xl bg-background p-2 font-mono text-xs break-all whitespace-pre-wrap">
                      {testResult.bodyPreview}
                    </pre>
                  )}
                </div>
              )}
            </SurfaceCardContent>
          </SurfaceCard>

          <SurfaceCard>
            <SurfaceCardHeader>
              <SurfaceCardTitle>Recent calls</SurfaceCardTitle>
              <SurfaceCardDescription>The last 50, kept for 30 days</SurfaceCardDescription>
            </SurfaceCardHeader>
            <SurfaceCardContent className="space-y-2 text-sm">
              {calls === null ? (
                <p className="text-muted-foreground">Loading...</p>
              ) : calls.length === 0 ? (
                <p className="text-muted-foreground">No calls yet.</p>
              ) : (
                calls.map((c) => (
                  <div key={c.id} className="flex items-start justify-between gap-3 border-b border-border/50 pb-2 last:border-0">
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">
                        {c.createdAt ? formatDate(c.createdAt) : "-"} · {c.latencyMs} ms
                        {c.httpStatus !== null ? ` · HTTP ${c.httpStatus}` : ""}
                      </p>
                      {(c.reason || c.error) && <p className="break-words">{c.reason ?? c.error}</p>}
                    </div>
                    <Badge variant={outcomeVariant(c.outcome)}>{OUTCOME_LABELS[c.outcome] ?? c.outcome}</Badge>
                  </div>
                ))
              )}
            </SurfaceCardContent>
          </SurfaceCard>
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={(o) => !busy && setFormOpen(o)}>
        <DialogContent className="sm:max-w-137.5">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Hook" : "New Hook"}</DialogTitle>
            <DialogDescription>
              Called on every purchase it covers, before payment. Your server has to answer within the time you set.
            </DialogDescription>
          </DialogHeader>

          <div className="-mx-6 no-scrollbar max-h-[60vh] space-y-6 overflow-y-auto px-6">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Membership check"
                  maxLength={80}
                />
              </div>
              <div className="space-y-1.5">
                <Label>URL</Label>
                <Input
                  value={form.url}
                  onChange={(e) => setForm((p) => ({ ...p, url: e.target.value }))}
                  placeholder="https://api.yourbusiness.com/hooks/purchase"
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  HTTPS on the standard port, with a public hostname.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Wait up to (milliseconds)</Label>
                <Input
                  type="number"
                  min={500}
                  max={2500}
                  value={form.timeoutMs}
                  onChange={(e) => setForm((p) => ({ ...p, timeoutMs: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">
                  Between 500 and 2500. The customer is waiting while we ask.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold">If your server can&apos;t be reached</h3>
                <p className="text-muted-foreground text-sm">
                  Timeouts, errors and answers we can&apos;t read all count. Nothing is preselected: choose deliberately.
                </p>
              </div>
              {/* The same cards as "Who is this for?" in the checkout: picking
                  between consequences is the same act in both places. */}
              <div className="space-y-2">
                <ChoiceOption
                  selected={form.failStrategy === "block"}
                  title="Stop the purchase"
                  detail="The customer is asked to try again later. Right for a rule that must hold, like an eligibility check. While your server is down, sales of the covered plans pause."
                  onClick={() => setForm((prev) => ({ ...prev, failStrategy: "block" }))}
                />
                <ChoiceOption
                  selected={form.failStrategy === "allow"}
                  title="Let the purchase through"
                  detail="Nothing stops while your server is down, but the check doesn't happen either."
                  onClick={() => setForm((prev) => ({ ...prev, failStrategy: "allow" }))}
                />
              </div>
            </div>

            <ScopePicker
              title="Plans"
              allLabel="Leave all unticked to cover every plan."
              options={plans}
              selected={form.planIds}
              onToggle={(id, on) => toggleId("planIds", id, on)}
            />
            <ScopePicker
              title="Locations"
              allLabel="Leave all unticked to cover every location."
              options={locations}
              selected={form.locationIds}
              onToggle={(id, on) => toggleId("locationIds", id, on)}
            />

            {formError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter className="flex flex-row">
            <UiButton variant="outline" onClick={() => setFormOpen(false)} disabled={busy !== null} className="flex-1">
              Cancel
            </UiButton>
            <UiButton
              onClick={save}
              disabled={busy !== null || !form.name.trim() || !form.url.trim()}
              className="flex-1"
            >
              {busy === "save" && <Loader2 className="size-4 animate-spin" />}
              {editing ? "Save Hook" : "Create Hook"}
            </UiButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={secret !== null} onOpenChange={(o) => !o && setSecret(null)}>
        <DialogContent className="sm:max-w-137.5">
          <DialogHeader>
            <DialogTitle>Your Signing Secret</DialogTitle>
            <DialogDescription>
              Copy it into your server now. This is the only time it&apos;s shown; if you lose it, issue a new one.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-2xl bg-muted/50 p-3">
            <ShieldCheck className="size-4 shrink-0 text-muted-foreground" />
            <code className="min-w-0 flex-1 font-mono text-xs break-all">{secret}</code>
            {secret && <CopyButton value={secret} />}
          </div>
          <p className="text-xs text-muted-foreground">
            Your server uses it to check the <span className="font-mono">OgaWiFi-Signature</span> header on every
            request, so it knows the request came from us and isn&apos;t a replay.
          </p>
          <DialogFooter className="flex flex-row">
            <UiButton onClick={() => setSecret(null)} className="flex-1">
              I&apos;ve saved it
            </UiButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete !== null} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this hook?</AlertDialogTitle>
            <AlertDialogDescription>
              Purchases stop being checked against your server straight away. Its call log is kept for 30 days.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = confirmDelete
                setConfirmDelete(null)
                if (target) void remove(target)
              }}
            >
              Delete hook
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right font-medium break-words">{value}</span>
    </div>
  )
}

function ScopePicker({
  title,
  allLabel,
  options,
  selected,
  onToggle,
}: {
  title: string
  allLabel: string
  options: Option[]
  selected: string[]
  onToggle: (id: string, on: boolean) => void
}) {
  if (options.length === 0) return null
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="text-xs text-muted-foreground">{allLabel}</p>
      <div className="space-y-2">
        {options.map((o) => (
          <label key={o.id} className="flex items-center gap-2 text-sm">
            <Checkbox checked={selected.includes(o.id)} onCheckedChange={(on) => onToggle(o.id, on === true)} />
            <span>{o.name}</span>
            {o.locationName && <span className="text-xs text-muted-foreground">{o.locationName}</span>}
          </label>
        ))}
      </div>
    </div>
  )
}
