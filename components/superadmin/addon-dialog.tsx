"use client"

import { useEffect, useState } from "react"
import { AlertCircle, ChevronDown } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/system/dialog"
import { Button } from "@/components/ui/button"
import { Button as SystemButton } from "@/components/system/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/system/dropdown-menu"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { auth } from "@/lib/firebase"
import { Addon, AddonPricingModel } from "@/types/schemas"

const PRICING_MODELS = [
  { value: "free", label: "Free (every tenant has it)" },
  { value: "one_time", label: "One-time (paid once, kept forever)" },
  { value: "subscription", label: "Subscription (recurring)" },
] as const

const BILLING_INTERVALS = [
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
] as const

interface AddonDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  addon: Addon | null
  /** What this key gates, from lib/addon-catalog.ts. */
  gates: string[]
  onSaved: (addons: Addon[]) => void
}

interface FormState {
  name: string
  description: string
  pricingModel: AddonPricingModel
  amountNaira: string
  billingInterval: "monthly" | "yearly"
  active: boolean
  sortOrder: string
}

export function AddonDialog({
  open,
  onOpenChange,
  addon,
  gates,
  onSaved,
}: AddonDialogProps) {
  const [form, setForm] = useState<FormState>({
    name: "",
    description: "",
    pricingModel: "subscription",
    amountNaira: "",
    billingInterval: "monthly",
    active: false,
    sortOrder: "0",
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!open || !addon) return
    setError("")
    setForm({
      name: addon.name,
      description: addon.description,
      pricingModel: addon.pricingModel,
      amountNaira: addon.amount ? String(addon.amount / 100) : "",
      billingInterval: addon.billingInterval,
      active: addon.active,
      sortOrder: String(addon.sortOrder),
    })
  }, [open, addon])

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const paid = form.pricingModel !== "free"

  async function save() {
    if (!addon) return
    setSaving(true)
    setError("")
    try {
      if (!auth?.currentUser) throw new Error("Not authenticated")
      const token = await auth.currentUser.getIdToken()

      const response = await fetch("/api/superadmin/addons", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          [addon.key]: {
            name: form.name.trim(),
            description: form.description.trim(),
            pricingModel: form.pricingModel,
            amount: paid
              ? Math.round((parseFloat(form.amountNaira) || 0) * 100)
              : 0,
            billingInterval: form.billingInterval,
            active: form.active,
            sortOrder: parseInt(form.sortOrder, 10) || 0,
          },
        }),
      })
      const data = await response.json()
      if (!data.success) throw new Error(data.error || "Could not save")

      onSaved(data.data.addons)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-137.5">
        <DialogHeader>
          <DialogTitle>Edit {addon?.name}</DialogTitle>
          <DialogDescription>
            Sold separately from the billing plan. A plan can also bundle this,
            in which case its tenants get it without paying.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-6 no-scrollbar max-h-[60vh] space-y-6 overflow-y-auto px-6">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Details</h3>
            <div className="space-y-1.5">
              <Label>Key</Label>
              <Input value={addon?.key ?? ""} disabled />
              <p className="text-xs text-muted-foreground">
                Set in lib/addon-catalog.ts. Addons are not created here
                because one only does anything if a route checks its key, and
                that is a code change.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                value={form.description}
                onChange={(e) => update("description", e.target.value)}
                placeholder="Shown to tenants on the Addons page"
                rows={2}
              />
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Pricing</h3>
            <div className="space-y-1.5">
              <Label>Pricing Model</Label>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<SystemButton tone="field" scale="sm" />}
                  className="w-full justify-between"
                >
                  <span className="truncate">
                    {
                      PRICING_MODELS.find((m) => m.value === form.pricingModel)
                        ?.label
                    }
                  </span>
                  <ChevronDown />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-72">
                  <DropdownMenuRadioGroup
                    value={form.pricingModel}
                    onValueChange={(value) =>
                      update("pricingModel", value as AddonPricingModel)
                    }
                  >
                    {PRICING_MODELS.map((model) => (
                      <DropdownMenuRadioItem
                        key={model.value}
                        value={model.value}
                      >
                        {model.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              {form.pricingModel === "subscription" && (
                <p className="text-xs text-muted-foreground">
                  Access ends if payment stops, after a 3 day grace period.
                </p>
              )}
            </div>

            {paid && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Price (₦)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.amountNaira}
                    onChange={(e) => update("amountNaira", e.target.value)}
                  />
                </div>
                {form.pricingModel === "subscription" && (
                  <div className="space-y-1.5">
                    <Label>Billing Interval</Label>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={<SystemButton tone="field" scale="sm" />}
                        className="w-full justify-between"
                      >
                        <span className="truncate">
                          {
                            BILLING_INTERVALS.find(
                              (i) => i.value === form.billingInterval
                            )?.label
                          }
                        </span>
                        <ChevronDown />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-40">
                        <DropdownMenuRadioGroup
                          value={form.billingInterval}
                          onValueChange={(value) =>
                            update(
                              "billingInterval",
                              value as "monthly" | "yearly"
                            )
                          }
                        >
                          {BILLING_INTERVALS.map((interval) => (
                            <DropdownMenuRadioItem
                              key={interval.value}
                              value={interval.value}
                            >
                              {interval.label}
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold">What this gates</h3>
            {/* Straight from lib/addon-catalog.ts, so the consequence of
                charging for this is visible at the moment of deciding. */}
            <ul className="space-y-1">
              {gates.map((gate) => (
                <li key={gate} className="text-xs text-muted-foreground">
                  {gate}
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Display</h3>
            <div className="flex items-center justify-between gap-3">
              <Label className="shrink-0">Sort Order</Label>
              <Input
                type="number"
                className="w-28"
                value={form.sortOrder}
                onChange={(e) => update("sortOrder", e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>Sellable</Label>
                <p className="text-xs text-muted-foreground">
                  Off hides it from tenants. Nobody already holding it loses
                  access.
                </p>
              </div>
              <Switch
                checked={form.active}
                onCheckedChange={(checked) => update("active", checked)}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="flex flex-row">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={saving || !form.name.trim()}
            className="flex-1"
          >
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
