"use client"

import { useState } from "react"
import { Lock, Unlock } from "lucide-react"

import type { Addon, AddonPricingModel } from "@/types/schemas"
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card"
import { PageHeader } from "@/components/system/page-header"
import { Button } from "@/components/system/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { toast } from "@/components/ui/toast"
import { auth } from "@/lib/firebase"

interface CatalogEntry {
  key: string
  name: string
  description: string
  gates: string[]
}

interface AddonsClientProps {
  initialAddons: Addon[]
  catalog: CatalogEntry[]
}

const MODELS: { value: AddonPricingModel; label: string; hint: string }[] = [
  { value: "free", label: "Free", hint: "On for every tenant, no payment." },
  { value: "one_time", label: "One-time", hint: "Paid once, never expires." },
  {
    value: "subscription",
    label: "Subscription",
    hint: "Recurring. Lapses if payment stops.",
  },
]

/** Kobo to a naira string for the input, and back. */
const toNaira = (kobo: number) => (kobo / 100).toString()
const toKobo = (naira: string) => Math.round((parseFloat(naira) || 0) * 100)

export function AddonsClient({ initialAddons, catalog }: AddonsClientProps) {
  const [addons, setAddons] = useState<Addon[]>(initialAddons)
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const gatesFor = (key: string) =>
    catalog.find((c) => c.key === key)?.gates ?? []

  function patch(key: string, changes: Partial<Addon>) {
    setAddons((prev) =>
      prev.map((a) => (a.key === key ? { ...a, ...changes } : a))
    )
    setDirty((prev) => new Set(prev).add(key))
  }

  async function save() {
    setSaving(true)
    setError("")
    try {
      const token = await auth?.currentUser?.getIdToken()
      // Only dirty rows: a save must never rewrite a row nobody touched.
      const payload: Record<string, unknown> = {}
      for (const addon of addons) {
        if (!dirty.has(addon.key)) continue
        payload[addon.key] = {
          name: addon.name,
          description: addon.description,
          pricingModel: addon.pricingModel,
          amount: addon.amount,
          billingInterval: addon.billingInterval,
          active: addon.active,
          sortOrder: addon.sortOrder,
        }
      }

      const response = await fetch("/api/superadmin/addons", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      })
      const result = await response.json()

      if (!result.success) {
        setError(result.error || "Could not save.")
        return
      }

      setDirty(new Set())
      toast.add({
        title: "Saved",
        description: `${dirty.size} addon${dirty.size === 1 ? "" : "s"} updated.`,
        type: "success",
      })
    } catch {
      setError("Could not save. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Addons"
        description="Features sold separately from the billing plan. A plan can also bundle one, in which case its tenants get it without paying here."
        action={
          <Button
            tone="action"
            onClick={save}
            disabled={saving || dirty.size === 0}
          >
            {saving ? "Saving..." : `Save${dirty.size ? ` (${dirty.size})` : ""}`}
          </Button>
        }
      />

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-4">
        {addons.map((addon) => (
          <SurfaceCard key={addon.key}>
            <SurfaceCardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <SurfaceCardTitle className="flex items-center gap-2">
                    {addon.name}
                    {addon.pricingModel === "free" ? (
                      <Badge variant="secondary" className="gap-1">
                        <Unlock className="size-3" />
                        Open to all
                      </Badge>
                    ) : addon.active ? (
                      <Badge className="gap-1">
                        <Lock className="size-3" />
                        Paid
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Not sellable</Badge>
                    )}
                  </SurfaceCardTitle>
                  <SurfaceCardDescription>
                    <code className="text-xs">{addon.key}</code>
                  </SurfaceCardDescription>
                </div>
                <Switch
                  checked={addon.active}
                  onCheckedChange={(active) => patch(addon.key, { active })}
                  aria-label={`${addon.name} sellable`}
                />
              </div>
            </SurfaceCardHeader>

            <SurfaceCardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor={`${addon.key}-name`}>Name</Label>
                  <Input
                    id={`${addon.key}-name`}
                    value={addon.name}
                    onChange={(e) => patch(addon.key, { name: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`${addon.key}-price`}>Price (naira)</Label>
                  <Input
                    id={`${addon.key}-price`}
                    type="number"
                    min="0"
                    step="50"
                    disabled={addon.pricingModel === "free"}
                    value={
                      addon.pricingModel === "free" ? "" : toNaira(addon.amount)
                    }
                    onChange={(e) =>
                      patch(addon.key, { amount: toKobo(e.target.value) })
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor={`${addon.key}-desc`}>Description</Label>
                <Input
                  id={`${addon.key}-desc`}
                  value={addon.description}
                  onChange={(e) =>
                    patch(addon.key, { description: e.target.value })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>Pricing</Label>
                <div className="flex flex-wrap gap-2">
                  {MODELS.map((model) => (
                    <Button
                      key={model.value}
                      tone={
                        addon.pricingModel === model.value ? "action" : "raised"
                      }
                      size="sm"
                      onClick={() =>
                        patch(addon.key, { pricingModel: model.value })
                      }
                    >
                      {model.label}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {MODELS.find((m) => m.value === addon.pricingModel)?.hint}
                </p>
              </div>

              {addon.pricingModel === "subscription" && (
                <div className="space-y-2">
                  <Label>Billed</Label>
                  <div className="flex gap-2">
                    {(["monthly", "yearly"] as const).map((interval) => (
                      <Button
                        key={interval}
                        tone={
                          addon.billingInterval === interval
                            ? "action"
                            : "raised"
                        }
                        size="sm"
                        onClick={() =>
                          patch(addon.key, { billingInterval: interval })
                        }
                      >
                        {interval === "monthly" ? "Monthly" : "Yearly"}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {/* Straight from lib/addon-catalog.ts, so the consequence of
                  charging for this is visible at the moment of deciding. */}
              <div className="rounded-panel bg-sunken p-3">
                <p className="text-xs font-medium">What this gates</p>
                <ul className="mt-1 space-y-1">
                  {gatesFor(addon.key).map((gate) => (
                    <li key={gate} className="text-xs text-muted-foreground">
                      {gate}
                    </li>
                  ))}
                </ul>
              </div>
            </SurfaceCardContent>
          </SurfaceCard>
        ))}
      </div>
    </>
  )
}
