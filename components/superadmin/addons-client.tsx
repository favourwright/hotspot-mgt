"use client"

import { useState } from "react"
import { Lock, Unlock } from "lucide-react"

import type { Addon } from "@/types/schemas"
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card"
import { PageHeader } from "@/components/system/page-header"
import { Button } from "@/components/system/button"
import { Badge } from "@/components/ui/badge"
import { toast } from "@/components/ui/toast"
import { formatNaira } from "@/lib/utils"
import { AddonDialog } from "@/components/superadmin/addon-dialog"

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

function priceLabel(addon: Addon): string {
  if (addon.pricingModel === "free") return "Free"
  if (addon.amount === 0) return "No price set"
  if (addon.pricingModel === "one_time") {
    return `${formatNaira(addon.amount)} once`
  }
  return `${formatNaira(addon.amount)} / ${
    addon.billingInterval === "yearly" ? "year" : "month"
  }`
}

export function AddonsClient({ initialAddons, catalog }: AddonsClientProps) {
  const [addons, setAddons] = useState(initialAddons)
  const [editing, setEditing] = useState<Addon | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const gatesFor = (key: string) =>
    catalog.find((entry) => entry.key === key)?.gates ?? []

  return (
    <>
      <PageHeader
        title="Addons"
        description="Features sold separately from the billing plan. A plan can bundle one, in which case its tenants get it without paying here."
      />

      <div className="space-y-4">
        {addons.map((addon) => (
          <SurfaceCard key={addon.key}>
            <SurfaceCardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <SurfaceCardTitle className="flex flex-wrap items-center gap-2">
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
                    {addon.description ? ` - ${addon.description}` : ""}
                  </SurfaceCardDescription>
                </div>
                <span className="shrink-0 text-sm font-medium">
                  {priceLabel(addon)}
                </span>
              </div>
            </SurfaceCardHeader>

            <SurfaceCardContent className="space-y-3">
              {/* Straight from lib/addon-catalog.ts, so the consequence of
                  charging for this is visible without opening the dialog. */}
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

              <Button
                tone="raised"
                size="sm"
                onClick={() => {
                  setEditing(addon)
                  setDialogOpen(true)
                }}
              >
                Edit
              </Button>
            </SurfaceCardContent>
          </SurfaceCard>
        ))}
      </div>

      <AddonDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        addon={editing}
        gates={editing ? gatesFor(editing.key) : []}
        onSaved={(next) => {
          setAddons(next)
          toast.add({ title: "Addon updated", type: "success" })
        }}
      />
    </>
  )
}
