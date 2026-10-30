"use client"

import { useState } from "react"
import Link from "next/link"
import { AlertCircle, KeyRound, Loader2, Plus, ShieldCheck } from "lucide-react"

import { apiClient } from "@/lib/api-client"
import { tenantHref } from "@/lib/tenant-url"
import { formatDate } from "@/lib/utils"
import type { ApiKeyView, ApiScope } from "@/lib/api-keys"
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

/** What each permission lets a key read, in plain words. */
const SCOPES: { scope: ApiScope; label: string; detail: string }[] = [
  { scope: "plans:read", label: "Plans", detail: "Your plans and their prices" },
  { scope: "locations:read", label: "Locations", detail: "Your locations" },
  { scope: "vouchers:read", label: "Vouchers", detail: "Vouchers sold, with login names but never passwords" },
  { scope: "payments:read", label: "Payments", detail: "Payments and your share of each" },
  { scope: "customers:read", label: "Customers", detail: "Customers' emails, totals, and your own ID for them" },
]

interface ApiKeysClientProps {
  tenantSlug: string
  initialKeys: ApiKeyView[]
  entitled: boolean
  canEdit: boolean
}

export function ApiKeysClient({ tenantSlug, initialKeys, entitled, canEdit }: ApiKeysClientProps) {
  const [keys, setKeys] = useState(initialKeys)
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState("")
  const [scopes, setScopes] = useState<ApiScope[]>([])
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [confirmRevoke, setConfirmRevoke] = useState<ApiKeyView | null>(null)

  const active = keys.filter((k) => !k.revokedAt)
  const revoked = keys.filter((k) => k.revokedAt)
  const canCreate = canEdit && entitled

  const reload = async () => {
    const res = (await apiClient.get("/api/admin/api-keys")) as unknown as { data: ApiKeyView[] }
    setKeys(res.data)
  }

  const openCreate = () => {
    setName("")
    setScopes([])
    setFormError(null)
    setCreateOpen(true)
  }

  const create = async () => {
    setBusy("create")
    setFormError(null)
    try {
      const res = (await apiClient.post("/api/admin/api-keys", { name, scopes })) as unknown as {
        data: { key: string }
      }
      setCreateOpen(false)
      setNewKey(res.data.key)
      await reload()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not create the key.")
    } finally {
      setBusy(null)
    }
  }

  const revoke = async (k: ApiKeyView) => {
    setBusy(`revoke:${k.keyId}`)
    try {
      await apiClient.delete(`/api/admin/api-keys/${k.keyId}`)
      toast.add({ title: "Key revoked", type: "success" })
      await reload()
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="API keys"
        description="Let your own systems read your plans, vouchers, payments and customers. Each key reads only what you allow."
        action={
          canCreate ? (
            <Button tone="action" onClick={openCreate}>
              <Plus className="size-4" />
              New key
            </Button>
          ) : undefined
        }
      />

      {!entitled && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            API keys are part of the API Access addon.{" "}
            <Link href={tenantHref(tenantSlug, "/admin/addons")} className="font-medium underline">
              Add it from the Addons page
            </Link>{" "}
            to create one. Existing keys stop working while it isn&apos;t active, and you can still revoke them.
          </AlertDescription>
        </Alert>
      )}

      {active.length === 0 ? (
        <SurfaceCard>
          <SurfaceCardContent>
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <KeyRound />
                </EmptyMedia>
                <EmptyTitle>No keys yet</EmptyTitle>
                <EmptyDescription>
                  A key lets a program you run read your data from our API. Give each system its own key,
                  so you can revoke one without touching the others.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </SurfaceCardContent>
        </SurfaceCard>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {active.map((k) => (
            <KeyCard key={k.keyId} apiKey={k}>
              {canEdit && (
                <SurfaceCardFooter>
                  <UiButton
                    size="sm"
                    variant="destructive"
                    disabled={busy !== null}
                    onClick={() => setConfirmRevoke(k)}
                  >
                    {busy === `revoke:${k.keyId}` && <Loader2 className="size-4 animate-spin" />}
                    Revoke
                  </UiButton>
                </SurfaceCardFooter>
              )}
            </KeyCard>
          ))}
        </div>
      )}

      {revoked.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Revoked</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {revoked.map((k) => (
              <KeyCard key={k.keyId} apiKey={k} />
            ))}
          </div>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={(o) => !busy && setCreateOpen(o)}>
        <DialogContent className="sm:max-w-137.5">
          <DialogHeader>
            <DialogTitle>New API Key</DialogTitle>
            <DialogDescription>
              Give it only the permissions the system using it needs. You can&apos;t change them later; make a new key instead.
            </DialogDescription>
          </DialogHeader>

          <div className="-mx-6 no-scrollbar max-h-[60vh] space-y-6 overflow-y-auto px-6">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Accounting sync"
                maxLength={80}
              />
              <p className="text-xs text-muted-foreground">So you can tell your keys apart.</p>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold">What it can read</h3>
              <div className="space-y-2">
                {SCOPES.map(({ scope, label, detail }) => (
                  <label key={scope} className="flex items-start gap-2 text-sm">
                    <Checkbox
                      className="mt-0.5"
                      checked={scopes.includes(scope)}
                      onCheckedChange={(on) =>
                        setScopes((prev) => (on === true ? [...prev, scope] : prev.filter((s) => s !== scope)))
                      }
                    />
                    <span>
                      <span className="font-medium">{label}</span>
                      <span className="block text-xs text-muted-foreground">{detail}</span>
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
            <UiButton variant="outline" onClick={() => setCreateOpen(false)} disabled={busy !== null} className="flex-1">
              Cancel
            </UiButton>
            <UiButton
              onClick={create}
              disabled={busy !== null || !name.trim() || scopes.length === 0}
              className="flex-1"
            >
              {busy === "create" && <Loader2 className="size-4 animate-spin" />}
              Create Key
            </UiButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={newKey !== null} onOpenChange={(o) => !o && setNewKey(null)}>
        <DialogContent className="sm:max-w-137.5">
          <DialogHeader>
            <DialogTitle>Your New API Key</DialogTitle>
            <DialogDescription>
              Copy it into your system now. This is the only time it&apos;s shown; if you lose it, revoke it and make another.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-2xl bg-muted/50 p-3">
            <ShieldCheck className="size-4 shrink-0 text-muted-foreground" />
            <code className="min-w-0 flex-1 font-mono text-xs break-all">{newKey}</code>
            {newKey && <CopyButton value={newKey} />}
          </div>
          <p className="text-xs text-muted-foreground">
            Send it as <span className="font-mono">Authorization: Bearer &lt;key&gt;</span>. Keep it on your server:
            never put it in a website or an app someone could download.
          </p>
          <DialogFooter className="flex flex-row">
            <UiButton onClick={() => setNewKey(null)} className="flex-1">
              I&apos;ve saved it
            </UiButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmRevoke !== null} onOpenChange={(o) => !o && setConfirmRevoke(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this key?</AlertDialogTitle>
            <AlertDialogDescription>
              Anything using it stops working straight away. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = confirmRevoke
                setConfirmRevoke(null)
                if (target) void revoke(target)
              }}
            >
              Revoke key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function KeyCard({ apiKey, children }: { apiKey: ApiKeyView; children?: React.ReactNode }) {
  return (
    <SurfaceCard>
      <SurfaceCardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <SurfaceCardTitle>{apiKey.name}</SurfaceCardTitle>
            <SurfaceCardDescription className="truncate font-mono">{apiKey.masked}</SurfaceCardDescription>
          </div>
          <Badge variant={apiKey.revokedAt ? "secondary" : "default"}>
            {apiKey.revokedAt ? "Revoked" : "Active"}
          </Badge>
        </div>
      </SurfaceCardHeader>
      <SurfaceCardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap gap-1.5">
          {apiKey.scopes.map((s) => (
            <Badge key={s} variant="outline" className="font-mono">
              {s}
            </Badge>
          ))}
        </div>
        <Row label="Created" value={apiKey.createdAt ? formatDate(apiKey.createdAt) : "-"} />
        <Row label="Last used" value={apiKey.lastUsedAt ? formatDate(apiKey.lastUsedAt) : "Never"} />
        <Row label="Requests" value={apiKey.requestCount.toLocaleString("en-NG")} />
        {apiKey.revokedAt && <Row label="Revoked" value={formatDate(apiKey.revokedAt)} />}
      </SurfaceCardContent>
      {children}
    </SurfaceCard>
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
