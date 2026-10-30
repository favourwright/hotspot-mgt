"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { AlertCircle, Loader2, Plus, Radio, ShieldCheck } from "lucide-react"

import { apiClient } from "@/lib/api-client"
import { tenantHref } from "@/lib/tenant-url"
import { formatDate } from "@/lib/utils"
import type { WebhookEndpointView } from "@/lib/webhooks"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/system/button"
import { Button as UiButton } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { CopyButton } from "@/components/shared/copy-button"
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
  SurfaceCardFooter,
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

interface EventType {
  type: string
  description: string
}

interface DeliveryRow {
  id: string
  type: string
  status: "pending" | "succeeded" | "failed" | "cancelled"
  attempts: number
  maxAttempts: number
  lastStatus: number | null
  lastError: string | null
  nextAttemptAt: string | null
  deliveredAt: string | null
  createdAt: string | null
}

interface TestResult {
  ok: boolean
  httpStatus: number | null
  error: string | null
  bodyPreview: string | null
}

interface WebhooksClientProps {
  tenantSlug: string
  initialEndpoints: WebhookEndpointView[]
  eventTypes: EventType[]
  entitled: boolean
  canEdit: boolean
}

interface FormState {
  url: string
  description: string
  events: string[]
}

const STATUS_LABELS: Record<DeliveryRow["status"], string> = {
  pending: "Retrying",
  succeeded: "Delivered",
  failed: "Gave up",
  cancelled: "Cancelled",
}

export function WebhooksClient({ tenantSlug, initialEndpoints, eventTypes, entitled, canEdit }: WebhooksClientProps) {
  const [endpoints, setEndpoints] = useState(initialEndpoints)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<WebhookEndpointView | null>(null)
  const [form, setForm] = useState<FormState>({ url: "", description: "", events: [] })
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<WebhookEndpointView | null>(null)
  const [tests, setTests] = useState<Record<string, TestResult>>({})
  const [openLog, setOpenLog] = useState<string | null>(null)
  const [deliveries, setDeliveries] = useState<DeliveryRow[] | null>(null)

  const canChange = canEdit && entitled

  const reload = async () => {
    const res = (await apiClient.get("/api/admin/webhooks")) as unknown as { data: WebhookEndpointView[] }
    setEndpoints(res.data)
  }

  // The open log, fetched when it changes. State is set only from the
  // callback, never synchronously in the effect.
  useEffect(() => {
    if (!openLog) return
    let cancelled = false
    ;(apiClient.get(`/api/admin/webhooks/${openLog}/deliveries`) as unknown as Promise<{ data: DeliveryRow[] }>)
      .then((res) => {
        if (!cancelled) setDeliveries(res.data)
      })
      .catch(() => {
        if (!cancelled) setDeliveries([])
      })
    return () => {
      cancelled = true
    }
  }, [openLog])

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
    setForm({ url: "", description: "", events: [] })
    setFormError(null)
    setFormOpen(true)
  }

  const openEdit = (e: WebhookEndpointView) => {
    setEditing(e)
    setForm({ url: e.url, description: e.description, events: e.events })
    setFormError(null)
    setFormOpen(true)
  }

  const save = async () => {
    setBusy("save")
    setFormError(null)
    try {
      if (editing) {
        await apiClient.patch(`/api/admin/webhooks/${editing.id}`, form)
        toast.add({ title: "Endpoint saved", type: "success" })
      } else {
        const res = (await apiClient.post("/api/admin/webhooks", form)) as unknown as { data: { secret: string } }
        setSecret(res.data.secret)
      }
      setFormOpen(false)
      await reload()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not save the endpoint.")
    } finally {
      setBusy(null)
    }
  }

  const refreshLog = async (id: string) => {
    const res = (await apiClient.get(`/api/admin/webhooks/${id}/deliveries`)) as unknown as { data: DeliveryRow[] }
    setDeliveries(res.data)
  }

  const showLog = (id: string) => {
    setDeliveries(null)
    setOpenLog(openLog === id ? null : id)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Webhooks"
        description={
          <>
            We tell your server the moment something happens: a voucher issued, renewed or failed, a payment received.{" "}
            <Link href="/developers" className="font-medium underline">
              Developer reference
            </Link>
          </>
        }
        action={
          canChange && endpoints.length < 5 ? (
            <Button tone="action" onClick={openCreate}>
              <Plus className="size-4" />
              New endpoint
            </Button>
          ) : undefined
        }
      />

      {!entitled && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Webhooks are part of the API Access addon.{" "}
            <Link href={tenantHref(tenantSlug, "/admin/addons")} className="font-medium underline">
              Add it from the Addons page
            </Link>{" "}
            to use them. No events are sent while it isn&apos;t active.
          </AlertDescription>
        </Alert>
      )}

      {endpoints.length === 0 ? (
        <SurfaceCard>
          <SurfaceCardContent>
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Radio />
                </EmptyMedia>
                <EmptyTitle>No endpoints yet</EmptyTitle>
                <EmptyDescription>
                  An endpoint is a URL on your server. Each event is sent there signed, retried for about a day if
                  your server is down, and listed in a delivery log.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </SurfaceCardContent>
        </SurfaceCard>
      ) : (
        <div className="space-y-4">
          {endpoints.map((e) => {
            const test = tests[e.id]
            return (
              <SurfaceCard key={e.id}>
                <SurfaceCardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <SurfaceCardTitle className="truncate font-mono">{e.url}</SurfaceCardTitle>
                      {e.description && <SurfaceCardDescription>{e.description}</SurfaceCardDescription>}
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      {e.active && e.failingSince && <Badge variant="destructive">Failing</Badge>}
                      <Badge variant={e.active ? "default" : "secondary"}>{e.active ? "On" : "Off"}</Badge>
                    </div>
                  </div>
                </SurfaceCardHeader>
                <SurfaceCardContent className="space-y-3 text-sm">
                  <div className="flex flex-wrap gap-1.5">
                    {e.events.length === 0 ? (
                      <Badge variant="outline">All events</Badge>
                    ) : (
                      e.events.map((t) => (
                        <Badge key={t} variant="outline" className="font-mono">
                          {t}
                        </Badge>
                      ))
                    )}
                  </div>
                  {e.disabledReason && !e.active && (
                    <p className="text-xs text-destructive">{e.disabledReason}. Fix your server, then switch it back on.</p>
                  )}
                  {e.active && e.failingSince && (
                    <p className="text-xs text-destructive">
                      Nothing accepted since {formatDate(e.failingSince)}. We keep retrying; after three days we switch it off and email you.
                    </p>
                  )}
                  {e.rotating && (
                    <p className="text-xs text-muted-foreground">
                      Signing with both your new and previous secret for 24 hours after a rotation.
                    </p>
                  )}

                  {test && (
                    <div className="space-y-1 rounded-2xl bg-muted/50 p-3">
                      <p className="font-medium">{test.ok ? "Your server accepted it" : "Your server didn't accept it"}</p>
                      <Row label="Status" value={test.httpStatus === null ? "No response" : String(test.httpStatus)} />
                      {test.error && <Row label="Why" value={test.error} />}
                      {test.bodyPreview && (
                        <pre className="max-h-32 overflow-auto rounded-xl bg-background p-2 font-mono text-xs break-all whitespace-pre-wrap">
                          {test.bodyPreview}
                        </pre>
                      )}
                    </div>
                  )}

                  {openLog === e.id && (
                    <div className="space-y-2 border-t border-border/50 pt-3">
                      <p className="font-medium">Recent deliveries</p>
                      {deliveries === null ? (
                        <p className="text-muted-foreground">Loading...</p>
                      ) : deliveries.length === 0 ? (
                        <p className="text-muted-foreground">Nothing sent yet.</p>
                      ) : (
                        deliveries.map((d) => (
                          <div key={d.id} className="flex items-start justify-between gap-3 border-b border-border/50 pb-2 last:border-0">
                            <div className="min-w-0">
                              <p className="font-mono text-xs">{d.type}</p>
                              <p className="text-xs text-muted-foreground">
                                {d.createdAt ? formatDate(d.createdAt) : "-"} · attempt {d.attempts} of {d.maxAttempts}
                                {d.lastStatus !== null ? ` · HTTP ${d.lastStatus}` : ""}
                                {d.status === "pending" && d.nextAttemptAt ? ` · next ${formatDate(d.nextAttemptAt)}` : ""}
                              </p>
                              {d.lastError && d.status !== "succeeded" && <p className="text-xs break-words">{d.lastError}</p>}
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-1.5">
                              <Badge variant={d.status === "succeeded" ? "default" : d.status === "pending" ? "secondary" : "destructive"}>
                                {STATUS_LABELS[d.status]}
                              </Badge>
                              {canChange && d.status !== "pending" && (
                                <UiButton
                                  size="sm"
                                  variant="outline"
                                  disabled={busy !== null}
                                  onClick={() =>
                                    run(`redeliver:${d.id}`, async () => {
                                      await apiClient.post(`/api/admin/webhooks/deliveries/${d.id}/redeliver`, {})
                                      await refreshLog(e.id)
                                    })
                                  }
                                >
                                  {busy === `redeliver:${d.id}` && <Loader2 className="size-4 animate-spin" />}
                                  Send again
                                </UiButton>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </SurfaceCardContent>

                {canEdit && (
                  <SurfaceCardFooter>
                    <div className="flex flex-wrap gap-2">
                      {/* Switching off needs neither the addon nor a paid-up account. */}
                      <UiButton
                        size="sm"
                        variant={e.active ? "outline" : "default"}
                        disabled={busy !== null || (!e.active && !canChange)}
                        onClick={() =>
                          run(`toggle:${e.id}`, async () => {
                            await apiClient.patch(`/api/admin/webhooks/${e.id}`, { active: !e.active })
                            toast.add({ title: e.active ? "Endpoint switched off" : "Endpoint switched on", type: "success" })
                            await reload()
                          })
                        }
                      >
                        {busy === `toggle:${e.id}` && <Loader2 className="size-4 animate-spin" />}
                        {e.active ? "Switch off" : "Switch on"}
                      </UiButton>
                      <UiButton
                        size="sm"
                        variant="outline"
                        disabled={busy !== null || !canChange}
                        onClick={() =>
                          run(`test:${e.id}`, async () => {
                            const res = (await apiClient.post(`/api/admin/webhooks/${e.id}/test`, {})) as unknown as { data: TestResult }
                            setTests((prev) => ({ ...prev, [e.id]: res.data }))
                          })
                        }
                      >
                        {busy === `test:${e.id}` && <Loader2 className="size-4 animate-spin" />}
                        Send test event
                      </UiButton>
                      <UiButton size="sm" variant="outline" disabled={busy !== null} onClick={() => showLog(e.id)}>
                        {openLog === e.id ? "Hide deliveries" : "Deliveries"}
                      </UiButton>
                      <UiButton size="sm" variant="outline" disabled={busy !== null || !canChange} onClick={() => openEdit(e)}>
                        Edit
                      </UiButton>
                      <UiButton
                        size="sm"
                        variant="outline"
                        disabled={busy !== null || !canChange}
                        onClick={() =>
                          run(`rotate:${e.id}`, async () => {
                            const res = (await apiClient.post(`/api/admin/webhooks/${e.id}/rotate-secret`, {})) as unknown as {
                              data: { secret: string }
                            }
                            setSecret(res.data.secret)
                            await reload()
                          })
                        }
                      >
                        New secret
                      </UiButton>
                      <UiButton size="sm" variant="destructive" disabled={busy !== null} onClick={() => setConfirmDelete(e)}>
                        Delete
                      </UiButton>
                    </div>
                  </SurfaceCardFooter>
                )}
              </SurfaceCard>
            )
          })}
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={(o) => !busy && setFormOpen(o)}>
        <DialogContent className="sm:max-w-137.5">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Endpoint" : "New Endpoint"}</DialogTitle>
            <DialogDescription>
              Where to send events. Your server should answer with any 2xx status quickly, and do slow work afterwards.
            </DialogDescription>
          </DialogHeader>

          <div className="-mx-6 no-scrollbar max-h-[60vh] space-y-6 overflow-y-auto px-6">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>URL</Label>
                <Input
                  value={form.url}
                  onChange={(ev) => setForm((p) => ({ ...p, url: ev.target.value }))}
                  placeholder="https://api.yourbusiness.com/webhooks/ogawifi"
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">HTTPS on the standard port, with a public hostname.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Description (optional)</Label>
                <Input
                  value={form.description}
                  onChange={(ev) => setForm((p) => ({ ...p, description: ev.target.value }))}
                  placeholder="Accounting system"
                  maxLength={120}
                />
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Events</h3>
              <p className="text-xs text-muted-foreground">Leave all unticked to receive every event, including ones we add later.</p>
              <div className="space-y-2">
                {eventTypes.map(({ type, description }) => (
                  <label key={type} className="flex items-start gap-2 text-sm">
                    <Checkbox
                      className="mt-0.5"
                      checked={form.events.includes(type)}
                      onCheckedChange={(on) =>
                        setForm((p) => ({
                          ...p,
                          events: on === true ? [...p.events, type] : p.events.filter((x) => x !== type),
                        }))
                      }
                    />
                    <span>
                      <span className="font-mono text-xs font-medium">{type}</span>
                      <span className="block text-xs text-muted-foreground">{description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

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
            <UiButton onClick={save} disabled={busy !== null || !form.url.trim()} className="flex-1">
              {busy === "save" && <Loader2 className="size-4 animate-spin" />}
              {editing ? "Save Endpoint" : "Create Endpoint"}
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
            Check the <span className="font-mono">OgaWiFi-Signature</span> header on every event with it, the same way as a
            decision hook, so you know the event came from us.
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
            <AlertDialogTitle>Delete this endpoint?</AlertDialogTitle>
            <AlertDialogDescription>
              Nothing more is sent to it, including retries already scheduled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = confirmDelete
                setConfirmDelete(null)
                if (target)
                  void run(`delete:${target.id}`, async () => {
                    await apiClient.delete(`/api/admin/webhooks/${target.id}`)
                    toast.add({ title: "Endpoint deleted", type: "success" })
                    if (openLog === target.id) setOpenLog(null)
                    await reload()
                  })
              }}
            >
              Delete endpoint
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
