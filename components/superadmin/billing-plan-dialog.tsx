"use client"

import { useErrorState } from "@/components/system/use-error-state";
import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/system/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/system/accordion"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/system/dropdown-menu"
import { Button as SystemButton } from "@/components/system/button"
import { ChevronDown } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle } from "lucide-react"
import { auth } from "@/lib/firebase"
import { Addon, BillingModel, BillingPlan } from "@/types/schemas"

interface BillingPlanDialogProps {
  mode: "create" | "edit"
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (plan: BillingPlan) => void
  plan?: BillingPlan | null
  /** The addon catalog, so a plan can bundle one. See lib/addon-catalog.ts. */
  addons: Pick<Addon, "key" | "name" | "pricingModel">[]
}

const BILLING_MODELS = [
  { value: "flat", label: "Flat (fixed monthly fee)" },
  { value: "usage", label: "Usage (% of each sale)" },
  { value: "hybrid", label: "Hybrid (fee + %)" },
  { value: "free", label: "Free" },
  { value: "custom", label: "Custom (contact us)" },
] as const

const BILLING_INTERVALS = [
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
] as const

interface FormState {
  name: string
  description: string
  billingModel: BillingModel
  monthlyFeeNaira: string
  platformFeePercent: string
  transactionFeeFlatNaira: string
  billingInterval: "monthly" | "yearly"
  trialDays: string
  /** On means the tenant's subaccount absorbs Paystack's processing fee. */
  tenantBearsPaystackFee: boolean
  maxLocationsUnlimited: boolean
  maxLocations: string
  maxRoutersUnlimited: boolean
  maxRouters: string
  maxCustomersUnlimited: boolean
  maxCustomers: string
  customBranding: boolean
  apiAccess: boolean
  prioritySupport: boolean
  includedAddons: string[]
  featureList: string
  badge: string
  active: boolean
  sortOrder: string
  contactUrl: string
}

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  billingModel: "flat",
  monthlyFeeNaira: "0",
  platformFeePercent: "0",
  transactionFeeFlatNaira: "0",
  billingInterval: "monthly",
  trialDays: "0",
  tenantBearsPaystackFee: false,
  maxLocationsUnlimited: true,
  maxLocations: "",
  maxRoutersUnlimited: true,
  maxRouters: "",
  maxCustomersUnlimited: true,
  maxCustomers: "",
  customBranding: false,
  apiAccess: false,
  prioritySupport: false,
  includedAddons: [],
  featureList: "",
  badge: "",
  active: true,
  sortOrder: "0",
  contactUrl: "",
}

function planToForm(plan: BillingPlan): FormState {
  return {
    name: plan.name,
    description: plan.description,
    billingModel: plan.billingModel,
    monthlyFeeNaira: String(plan.monthlyFee / 100),
    platformFeePercent: String(plan.platformFeePercent),
    transactionFeeFlatNaira: String(plan.transactionFeeFlat / 100),
    billingInterval: plan.billingInterval,
    trialDays: String(plan.trialDays),
    tenantBearsPaystackFee: plan.paystackBearer === "subaccount",
    maxLocationsUnlimited: plan.limits.maxLocations === null,
    maxLocations: plan.limits.maxLocations
      ? String(plan.limits.maxLocations)
      : "",
    maxRoutersUnlimited: plan.limits.maxRouters === null,
    maxRouters: plan.limits.maxRouters ? String(plan.limits.maxRouters) : "",
    maxCustomersUnlimited: plan.limits.maxCustomers === null,
    maxCustomers: plan.limits.maxCustomers
      ? String(plan.limits.maxCustomers)
      : "",
    customBranding: plan.features.customBranding,
    apiAccess: plan.features.apiAccess,
    prioritySupport: plan.features.prioritySupport,
    includedAddons: plan.includedAddons ?? [],
    featureList: plan.featureList.join("\n"),
    badge: plan.badge ?? "",
    active: plan.active,
    sortOrder: String(plan.sortOrder),
    contactUrl: plan.contactUrl ?? "",
  }
}

// billingModel drives which pricing fields actually apply - locking the
// irrelevant ones to 0 keeps a plan's pricing unambiguous (e.g. a "usage"
// plan should never silently carry a leftover monthly fee).
function lockedFields(model: BillingModel) {
  return {
    monthlyFeeLocked: model === "usage" || model === "free" || model === "custom",
    platformFeeLocked: model === "flat" || model === "free" || model === "custom",
    transactionFeeLocked: model === "flat" || model === "free" || model === "custom",
  }
}

export function BillingPlanDialog({
  mode,
  open,
  onOpenChange,
  onSaved,
  plan,
  addons,
}: BillingPlanDialogProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useErrorState("Couldn't save billing plan")

  useEffect(() => {
    if (!open) return
    setError(null)
    if (mode === "edit" && plan) {
      setForm(planToForm(plan))
    } else {
      setForm(EMPTY_FORM)
    }
  }, [open, mode, plan])

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const { monthlyFeeLocked, platformFeeLocked, transactionFeeLocked } =
    lockedFields(form.billingModel)

  const handleSubmit = async () => {
    setError(null)

    if (!form.name.trim()) {
      setError("Plan name is required")
      return
    }

    setSaving(true)
    try {
      if (!auth?.currentUser) throw new Error("Not authenticated")
      const token = await auth.currentUser.getIdToken()

      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        billingModel: form.billingModel,
        monthlyFee: monthlyFeeLocked
          ? 0
          : Math.round(Number(form.monthlyFeeNaira || 0) * 100),
        platformFeePercent: platformFeeLocked
          ? 0
          : Number(form.platformFeePercent || 0),
        transactionFeeFlat: transactionFeeLocked
          ? 0
          : Math.round(Number(form.transactionFeeFlatNaira || 0) * 100),
        billingInterval: form.billingInterval,
        trialDays: Number(form.trialDays || 0),
        // Null, not "account", when the switch is off: that means "inherit
        // the platform setting", which is what every plan did before this
        // field existed. Writing "account" would pin the plan against a
        // future change to that default.
        paystackBearer: form.tenantBearsPaystackFee ? "subaccount" : null,
        limits: {
          maxLocations: form.maxLocationsUnlimited
            ? null
            : Number(form.maxLocations || 0) || null,
          maxRouters: form.maxRoutersUnlimited
            ? null
            : Number(form.maxRouters || 0) || null,
          maxCustomers: form.maxCustomersUnlimited
            ? null
            : Number(form.maxCustomers || 0) || null,
        },
        features: {
          customBranding: form.customBranding,
          apiAccess: form.apiAccess,
          prioritySupport: form.prioritySupport,
        },
        includedAddons: form.includedAddons,
        featureList: form.featureList
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
        badge: form.badge.trim() || null,
        active: form.active,
        sortOrder: Number(form.sortOrder || 0),
        contactUrl: form.contactUrl.trim() || null,
      }

      const url =
        mode === "create"
          ? "/api/superadmin/billing-plans"
          : `/api/superadmin/billing-plans/${plan!.id}`

      const response = await fetch(url, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      })

      const data = await response.json()
      if (!data.success)
        throw new Error(data.error || "Failed to save billing plan")

      onSaved(data.data as BillingPlan)
      onOpenChange(false)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save billing plan"
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-137.5">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Add Billing Plan" : "Edit Billing Plan"}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Create a new subscription tier tenants can choose from during onboarding."
              : "Update this plan. Existing tenants keep their locked-in price; only limits/features apply live."}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-6 no-scrollbar max-h-[60vh] space-y-6 overflow-y-auto px-6">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Basic Info</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => update("name", e.target.value)}
                  placeholder="Growth"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Billing Model</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<SystemButton tone="field" scale="sm" />}
                    className="w-full justify-between"
                  >
                    <span className="truncate">
                      {BILLING_MODELS.find((m) => m.value === form.billingModel)
                        ?.label ?? "Select a model"}
                    </span>
                    <ChevronDown />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-64">
                    <DropdownMenuRadioGroup
                      value={form.billingModel}
                      onValueChange={(value) =>
                        update("billingModel", value as BillingModel)
                      }
                    >
                      {BILLING_MODELS.map((model) => (
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
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                value={form.description}
                onChange={(e) => update("description", e.target.value)}
                placeholder="Short description shown to tenants during onboarding"
                rows={2}
              />
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Pricing</h3>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Monthly Fee (₦)</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.monthlyFeeNaira}
                  disabled={monthlyFeeLocked}
                  onChange={(e) => update("monthlyFeeNaira", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Platform Fee (%)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={form.platformFeePercent}
                  disabled={platformFeeLocked}
                  onChange={(e) => update("platformFeePercent", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Flat Fee / Sale (₦)</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.transactionFeeFlatNaira}
                  disabled={transactionFeeLocked}
                  onChange={(e) =>
                    update("transactionFeeFlatNaira", e.target.value)
                  }
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Billing Interval</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<SystemButton tone="field" scale="sm" />}
                    className="w-full justify-between"
                  >
                    <span className="truncate">
                      {BILLING_INTERVALS.find(
                        (i) => i.value === form.billingInterval
                      )?.label ?? "Monthly"}
                    </span>
                    <ChevronDown />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-40">
                    <DropdownMenuRadioGroup
                      value={form.billingInterval}
                      onValueChange={(value) =>
                        update("billingInterval", value as "monthly" | "yearly")
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
              <div className="space-y-1.5">
                <Label>Trial Days</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.trialDays}
                  onChange={(e) => update("trialDays", e.target.value)}
                />
              </div>
            </div>
            {form.billingModel === "custom" && (
              <div className="space-y-1.5">
                <Label>Contact Link</Label>
                <Input
                  value={form.contactUrl}
                  onChange={(e) => update("contactUrl", e.target.value)}
                  placeholder="mailto:sales@yourcompany.com"
                />
                <p className="text-xs text-muted-foreground">
                  Shown as the &quot;Contact Us&quot; action on this plan&apos;s onboarding
                  card. Leave blank to show plain text with no link instead.
                </p>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Limits</h3>
            <p className="text-xs text-muted-foreground">
              Checked live against a tenant&apos;s current plan - not locked in
              at signup.
            </p>
            {(
              [
                {
                  key: "maxLocations",
                  unlimitedKey: "maxLocationsUnlimited",
                  label: "Locations",
                  placeholder: "e.g. 3",
                },
                {
                  key: "maxRouters",
                  unlimitedKey: "maxRoutersUnlimited",
                  label: "Routers",
                  placeholder: "e.g. 5",
                },
                {
                  key: "maxCustomers",
                  unlimitedKey: "maxCustomersUnlimited",
                  label: "Customers",
                  placeholder: "e.g. 500",
                },
              ] as const
            ).map(({ key, unlimitedKey, label, placeholder }) => (
              // Label at one end, controls at the other -- the same
              // justified row the Features switches below already use.
              <div
                key={key}
                className="flex items-center justify-between gap-3"
              >
                <Label className="shrink-0">{label}</Label>
                <div className="flex items-center gap-3">
                  <Input
                    type="number"
                    min={1}
                    className="w-28"
                    placeholder={form[unlimitedKey] ? "Unlimited" : placeholder}
                    value={form[key]}
                    disabled={form[unlimitedKey]}
                    onChange={(e) => update(key, e.target.value)}
                  />
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={form[unlimitedKey]}
                      onCheckedChange={(checked) =>
                        update(unlimitedKey, checked)
                      }
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Features</h3>
            <div className="flex items-center justify-between">
              <Label>Custom Branding</Label>
              <Switch
                checked={form.customBranding}
                onCheckedChange={(checked) => update("customBranding", checked)}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label>API Access</Label>
              <Switch
                checked={form.apiAccess}
                onCheckedChange={(checked) => update("apiAccess", checked)}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label>Priority Support</Label>
              <Switch
                checked={form.prioritySupport}
                onCheckedChange={(checked) =>
                  update("prioritySupport", checked)
                }
              />
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Included Addons</h3>
            <p className="text-xs text-muted-foreground">
              Bundled into this plan, so its tenants get them without paying
              separately. Resolved as &quot;granted by my plan OR purchased&quot;, so
              removing one here only withdraws the free grant - it never
              revokes an addon a tenant bought themselves.
            </p>
            {addons.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No addons are configured yet.
              </p>
            ) : (
              addons.map((addon) => (
                <div
                  key={addon.key}
                  className="flex items-center justify-between gap-3"
                >
                  <div>
                    <Label>{addon.name}</Label>
                    {addon.pricingModel === "free" && (
                      // Bundling something already free is a no-op, and
                      // saying so beats letting someone think a tier is
                      // differentiated when it is not.
                      <p className="text-xs text-muted-foreground">
                        Already free for everyone, so bundling changes nothing.
                      </p>
                    )}
                  </div>
                  <Switch
                    checked={form.includedAddons.includes(addon.key)}
                    onCheckedChange={(checked) =>
                      update(
                        "includedAddons",
                        checked
                          ? [...form.includedAddons, addon.key]
                          : form.includedAddons.filter((k) => k !== addon.key)
                      )
                    }
                  />
                </div>
              ))
            )}
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Display</h3>
            <div className="space-y-1.5">
              <Label>
                Feature List (one per line, shown on the onboarding card)
              </Label>
              <Textarea
                value={form.featureList}
                onChange={(e) => update("featureList", e.target.value)}
                placeholder={
                  "Unlimited vouchers\nEmail support\n1 location included"
                }
                rows={4}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Badge</Label>
                <Input
                  value={form.badge}
                  onChange={(e) => update("badge", e.target.value)}
                  placeholder="Most Popular"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Sort Order</Label>
                <Input
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) => update("sortOrder", e.target.value)}
                  placeholder="e.g. 1"
                />
              </div>
            </div>
            {/* Its own row, justified like the Features and Limits switches
                -- a toggle under a text label in a grid column reads as a
                third input, which it isn't. */}
            <div className="flex items-center justify-between gap-3">
              <Label>Selectable by new tenants</Label>
              <Switch
                checked={form.active}
                onCheckedChange={(checked) => update("active", checked)}
              />
            </div>
          </div>

          {/* Collapsed by default: these change who money comes out of, and
              nothing here should be adjusted by someone passing through the
              dialog to rename a plan. `px-0` on the trigger and content
              lines the rows up with the sections above, which carry the
              dialog's own padding rather than a card's. */}
          <Accordion>
            <AccordionItem value="advanced">
              <AccordionTrigger className="px-0 py-3 text-sm font-semibold hover:bg-transparent">
                Advanced settings
              </AccordionTrigger>
              <AccordionContent className="px-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <Label>Tenant bears Paystack&apos;s transaction fee</Label>
                    <p className="text-xs text-muted-foreground">
                      Paystack&apos;s own processing fee comes out of the
                      tenant&apos;s share of each voucher sale instead of the
                      platform&apos;s. Off leaves it on the platform-wide
                      setting, which is how every plan behaved before this
                      switch existed.
                    </p>
                  </div>
                  <Switch
                    checked={form.tenantBearsPaystackFee}
                    onCheckedChange={(checked) =>
                      update("tenantBearsPaystackFee", checked)
                    }
                  />
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
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
          <Button onClick={handleSubmit} disabled={saving} className="flex-1">
            {saving
              ? "Saving..."
              : mode === "create"
                ? "Create Plan"
                : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
