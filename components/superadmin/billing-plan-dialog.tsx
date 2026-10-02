"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { auth } from "@/lib/firebase";
import { BillingModel, BillingPlan } from "@/types/schemas";

interface BillingPlanDialogProps {
  mode: "create" | "edit";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (plan: BillingPlan) => void;
  plan?: BillingPlan | null;
}

interface FormState {
  name: string;
  description: string;
  billingModel: BillingModel;
  monthlyFeeNaira: string;
  platformFeePercent: string;
  transactionFeeFlatNaira: string;
  billingInterval: "monthly" | "yearly";
  trialDays: string;
  maxLocationsUnlimited: boolean;
  maxLocations: string;
  maxRoutersUnlimited: boolean;
  maxRouters: string;
  maxCustomersUnlimited: boolean;
  maxCustomers: string;
  customBranding: boolean;
  apiAccess: boolean;
  prioritySupport: boolean;
  featureList: string;
  badge: string;
  active: boolean;
  sortOrder: string;
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
  maxLocationsUnlimited: true,
  maxLocations: "",
  maxRoutersUnlimited: true,
  maxRouters: "",
  maxCustomersUnlimited: true,
  maxCustomers: "",
  customBranding: false,
  apiAccess: false,
  prioritySupport: false,
  featureList: "",
  badge: "",
  active: true,
  sortOrder: "0",
};

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
    maxLocationsUnlimited: plan.limits.maxLocations === null,
    maxLocations: plan.limits.maxLocations ? String(plan.limits.maxLocations) : "",
    maxRoutersUnlimited: plan.limits.maxRouters === null,
    maxRouters: plan.limits.maxRouters ? String(plan.limits.maxRouters) : "",
    maxCustomersUnlimited: plan.limits.maxCustomers === null,
    maxCustomers: plan.limits.maxCustomers ? String(plan.limits.maxCustomers) : "",
    customBranding: plan.features.customBranding,
    apiAccess: plan.features.apiAccess,
    prioritySupport: plan.features.prioritySupport,
    featureList: plan.featureList.join("\n"),
    badge: plan.badge ?? "",
    active: plan.active,
    sortOrder: String(plan.sortOrder),
  };
}

// billingModel drives which pricing fields actually apply — locking the
// irrelevant ones to 0 keeps a plan's pricing unambiguous (e.g. a "usage"
// plan should never silently carry a leftover monthly fee).
function lockedFields(model: BillingModel) {
  return {
    monthlyFeeLocked: model === "usage" || model === "free",
    platformFeeLocked: model === "flat" || model === "free",
    transactionFeeLocked: model === "flat" || model === "free",
  };
}

export function BillingPlanDialog({
  mode,
  open,
  onOpenChange,
  onSaved,
  plan,
}: BillingPlanDialogProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (mode === "edit" && plan) {
      setForm(planToForm(plan));
    } else {
      setForm(EMPTY_FORM);
    }
  }, [open, mode, plan]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const { monthlyFeeLocked, platformFeeLocked, transactionFeeLocked } =
    lockedFields(form.billingModel);

  const handleSubmit = async () => {
    setError(null);

    if (!form.name.trim()) {
      setError("Plan name is required");
      return;
    }

    setSaving(true);
    try {
      if (!auth?.currentUser) throw new Error("Not authenticated");
      const token = await auth.currentUser.getIdToken();

      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        billingModel: form.billingModel,
        monthlyFee: monthlyFeeLocked ? 0 : Math.round(Number(form.monthlyFeeNaira || 0) * 100),
        platformFeePercent: platformFeeLocked ? 0 : Number(form.platformFeePercent || 0),
        transactionFeeFlat: transactionFeeLocked
          ? 0
          : Math.round(Number(form.transactionFeeFlatNaira || 0) * 100),
        billingInterval: form.billingInterval,
        trialDays: Number(form.trialDays || 0),
        limits: {
          maxLocations: form.maxLocationsUnlimited ? null : Number(form.maxLocations || 0) || null,
          maxRouters: form.maxRoutersUnlimited ? null : Number(form.maxRouters || 0) || null,
          maxCustomers: form.maxCustomersUnlimited ? null : Number(form.maxCustomers || 0) || null,
        },
        features: {
          customBranding: form.customBranding,
          apiAccess: form.apiAccess,
          prioritySupport: form.prioritySupport,
        },
        featureList: form.featureList
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
        badge: form.badge.trim() || null,
        active: form.active,
        sortOrder: Number(form.sortOrder || 0),
      };

      const url =
        mode === "create"
          ? "/api/superadmin/billing-plans"
          : `/api/superadmin/billing-plans/${plan!.id}`;

      const response = await fetch(url, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!data.success) throw new Error(data.error || "Failed to save billing plan");

      onSaved(data.data as BillingPlan);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save billing plan");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-137.5">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add Billing Plan" : "Edit Billing Plan"}</DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Create a new subscription tier tenants can choose from during onboarding."
              : "Update this plan. Existing tenants keep their locked-in price; only limits/features apply live."}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-6 max-h-[60vh] overflow-y-auto px-6 no-scrollbar space-y-6">
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
                <Select
                  value={form.billingModel}
                  onValueChange={(value) => update("billingModel", value as BillingModel)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="flat">Flat (fixed monthly fee)</SelectItem>
                    <SelectItem value="usage">Usage (% of each sale)</SelectItem>
                    <SelectItem value="hybrid">Hybrid (fee + %)</SelectItem>
                    <SelectItem value="free">Free</SelectItem>
                  </SelectContent>
                </Select>
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
                  onChange={(e) => update("transactionFeeFlatNaira", e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Billing Interval</Label>
                <Select
                  value={form.billingInterval}
                  onValueChange={(value) =>
                    update("billingInterval", value as "monthly" | "yearly")
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="yearly">Yearly</SelectItem>
                  </SelectContent>
                </Select>
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
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Limits</h3>
            <p className="text-xs text-muted-foreground">
              Checked live against a tenant&apos;s current plan — not locked in at signup.
            </p>
            {([
              { key: "maxLocations", unlimitedKey: "maxLocationsUnlimited", label: "Locations" },
              { key: "maxRouters", unlimitedKey: "maxRoutersUnlimited", label: "Routers" },
              { key: "maxCustomers", unlimitedKey: "maxCustomersUnlimited", label: "Customers" },
            ] as const).map(({ key, unlimitedKey, label }) => (
              <div key={key} className="flex items-center gap-3">
                <Label className="w-24 shrink-0">{label}</Label>
                <Input
                  type="number"
                  min={1}
                  className="w-32"
                  value={form[key]}
                  disabled={form[unlimitedKey]}
                  onChange={(e) => update(key, e.target.value)}
                />
                <div className="flex items-center gap-2">
                  <Switch
                    checked={form[unlimitedKey]}
                    onCheckedChange={(checked) => update(unlimitedKey, checked)}
                  />
                  <span className="text-sm text-muted-foreground">Unlimited</span>
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
                onCheckedChange={(checked) => update("prioritySupport", checked)}
              />
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Display</h3>
            <div className="space-y-1.5">
              <Label>Feature List (one per line, shown on the onboarding card)</Label>
              <Textarea
                value={form.featureList}
                onChange={(e) => update("featureList", e.target.value)}
                placeholder={"Unlimited vouchers\nEmail support\n1 location included"}
                rows={4}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
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
                />
              </div>
              <div className="space-y-1.5">
                <Label>Selectable by new tenants</Label>
                <div className="flex items-center h-9">
                  <Switch
                    checked={form.active}
                    onCheckedChange={(checked) => update("active", checked)}
                  />
                </div>
              </div>
            </div>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="mt-6">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Saving..." : mode === "create" ? "Create Plan" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
