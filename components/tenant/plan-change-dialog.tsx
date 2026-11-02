"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/system/dialog";
import { Panel } from "@/components/system/surface-card";
import { toast } from "@/components/ui/toast";
import { useAuth } from "@/providers/auth-provider";
import { Step2ChoosePlan } from "@/components/onboarding/step-choose-plan";
import type { OnboardingPlan } from "@/components/onboarding/types";
import { formatNaira } from "@/lib/utils";

/**
 * An owner moving themselves between billing tiers.
 *
 * ## Why this is not the onboarding wizard
 *
 * There was an idea to send a lapsed tenant back through `/onboarding` and
 * reuse the whole four-step flow for this. It does not survive contact with
 * what that flow does: step 3 creates a Paystack subaccount, which this
 * tenant already has and must not have replaced, and `create-tenant` grants
 * a fresh waiver whenever the chosen plan has `trialDays` - so a tenant who
 * lapsed and went round again would collect a new free month every time.
 *
 * What is worth reusing is the *card*, and that is what happens here:
 * `Step2ChoosePlan` is the same component onboarding renders, so a plan
 * reads identically whether you are choosing it for the first time or
 * switching to it two years in.
 *
 * ## The acknowledgement
 *
 * A smaller plan has smaller limits, and the tenant who needs a cheaper plan
 * is usually the one already over them. Refusing the downgrade would leave
 * them with "pay or leave", which is how an account is lost rather than
 * downgraded. So it is allowed, and what it pauses is spelled out and has to
 * be ticked.
 *
 * The wording of those consequences comes from the server
 * (`lib/plan-change.ts`) rather than being written here, because the same
 * function decides whether the tick is required. A warning phrased in the
 * browser and a rule enforced on the server drift, and the direction they
 * drift in is "warned about the wrong thing".
 */
interface PlanOption extends OnboardingPlan {
  breaches: {
    limit: "maxRouters" | "maxLocations" | "maxCustomers";
    current: number;
    allowed: number;
    consequence: string;
  }[];
}

export function PlanChangeDialog({
  currentPlanId,
  currentPlanName,
}: {
  currentPlanId: string;
  currentPlanName: string;
}) {
  const router = useRouter();
  const { user } = useAuth();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [selectedId, setSelectedId] = useState(currentPlanId);
  const [accepted, setAccepted] = useState(false);

  /**
   * Fetched when the button is clicked, not from an effect on `open`.
   *
   * Both would work, and the effect version is what this started as - but
   * the fetch is a *consequence of the click*, not a synchronisation with
   * anything, so an effect is the wrong tool and `react-hooks/set-state-in-effect`
   * says so. Doing it here also means the request is already in flight
   * before the dialog has finished animating in.
   *
   * Loaded on open rather than with the page because the usage counts behind
   * the breach calculation are three aggregate reads, and most visits to
   * settings are not about changing plan.
   */
  const openDialog = async () => {
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      const token = await user?.getIdToken();
      const response = await fetch("/api/admin/billing/plan", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await response.json();
      if (!json.success) throw new Error(json.error || "Couldn't load plans");
      setPlans(json.data.plans);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load plans");
    } finally {
      setLoading(false);
    }
  };

  const selected = plans.find((plan) => plan.id === selectedId) ?? null;
  const breaches = selected && selected.id !== currentPlanId ? selected.breaches : [];
  const needsAcknowledgement = breaches.length > 0;
  const unchanged = selectedId === currentPlanId;

  const submit = async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const token = await user?.getIdToken();
      const response = await fetch("/api/admin/billing/plan", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          planId: selected.id,
          acceptFrozenLimits: accepted,
        }),
      });
      const json = await response.json();
      if (!json.success) throw new Error(json.error || "Couldn't change plan");

      toast.add({
        title: `You're on ${selected.name}`,
        description:
          selected.monthlyFee === 0
            ? "There's no monthly fee on this plan."
            : `Your plan fee is now ${formatNaira(selected.monthlyFee)} a month.`,
        type: "success",
      });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't change plan");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={openDialog}>
        Change plan
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          // Reset on close, so reopening never shows a tick the owner gave
          // for a plan they then backed out of.
          if (!next) {
            setSelectedId(currentPlanId);
            setAccepted(false);
            setError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-175">
          <DialogHeader>
            <DialogTitle>Change your plan</DialogTitle>
            <DialogDescription>
              You&apos;re on {currentPlanName}. Moving takes effect
              immediately, and your vouchers, customers and routers are not
              deleted by any change here.
            </DialogDescription>
          </DialogHeader>

          <div className="-mx-6 no-scrollbar max-h-[60vh] space-y-6 overflow-y-auto px-6">
            <Step2ChoosePlan
              state={{ planId: selectedId }}
              updateField={(field, value) => {
                if (field !== "planId") return;
                setSelectedId(String(value));
                // A tick belongs to one plan. Carrying it to the next one
                // would let somebody acknowledge a 2-router cap and land on
                // a 1-router plan without being asked again.
                setAccepted(false);
              }}
              plans={plans}
              plansLoading={loading}
              heading="Pick a plan"
              description="Your current plan is selected"
            />

            {needsAcknowledgement && (
              <div className="space-y-3">
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {selected?.name} is smaller than what you&apos;re running
                    now. Nothing is deleted, but some things stop being
                    possible.
                  </AlertDescription>
                </Alert>

                <Panel className="space-y-3 text-sm">
                  {breaches.map((breach) => (
                    <div key={breach.limit} className="space-y-1">
                      <div className="flex justify-between gap-3">
                        <span className="text-muted-foreground">
                          {breach.limit === "maxRouters"
                            ? "Routers"
                            : breach.limit === "maxLocations"
                              ? "Locations"
                              : "Active customers (30 days)"}
                        </span>
                        <span className="font-medium">
                          {breach.current} now, {breach.allowed} allowed
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {breach.consequence}
                      </p>
                    </div>
                  ))}
                </Panel>

                <Label className="flex items-start gap-2 text-sm font-normal">
                  <Checkbox
                    checked={accepted}
                    onCheckedChange={(checked) => setAccepted(checked === true)}
                    className="mt-0.5"
                  />
                  <span>
                    I understand this pauses the things listed above until
                    I&apos;m back under the limits.
                  </span>
                </Label>
              </div>
            )}

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
              onClick={() => setOpen(false)}
              disabled={saving}
              className="flex-1"
            >
              Never mind
            </Button>
            <Button
              onClick={submit}
              disabled={
                saving ||
                loading ||
                unchanged ||
                (needsAcknowledgement && !accepted)
              }
              className="flex-1"
            >
              {saving
                ? "Changing..."
                : unchanged
                  ? "Pick a different plan"
                  : `Move to ${selected?.name ?? "this plan"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
