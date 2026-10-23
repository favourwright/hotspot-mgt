"use client";

import { useState } from "react";

import { apiClient } from "@/lib/api-client";
import { Button } from "@/components/system/button";
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardFooter,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";

interface RenewalSettingsProps {
  initial: {
    renewalExpiryMode: "extend" | "reset";
    renewalDataMode: "carry" | "reset";
  };
  /**
   * False for a superadmin viewing someone else's plans. The API refuses the
   * write regardless; this stops offering an action that would be refused,
   * the same as PortalSettings.
   */
  canEdit: boolean;
}

/**
 * What a repeat purchase does to a customer who still has time or data left.
 *
 * On the plans page rather than in Settings because it is a statement about
 * what a plan is worth when you buy it twice, and because it is the page an
 * owner is on when they think about it. It is tenant-wide all the same: a
 * house rule that differed per plan would have to be explained to the same
 * customer twice.
 *
 * Both switches are phrased as the opt-in ("start again") with the default
 * off, so the position they ship in is the behaviour that already existed.
 * Saved behind a button rather than on change, like PortalSettings: these
 * two decide what the next customer pays for, and a mis-tap that applied
 * itself silently is the wrong kind of cheap.
 */
export function RenewalSettings({ initial, canEdit }: RenewalSettingsProps) {
  const [resetExpiry, setResetExpiry] = useState(
    initial.renewalExpiryMode === "reset"
  );
  const [resetData, setResetData] = useState(
    initial.renewalDataMode === "reset"
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(initial);

  const dirty =
    (resetExpiry ? "reset" : "extend") !== saved.renewalExpiryMode ||
    (resetData ? "reset" : "carry") !== saved.renewalDataMode;

  async function save() {
    setSaving(true);
    try {
      const next = {
        renewalExpiryMode: (resetExpiry ? "reset" : "extend") as
          | "reset"
          | "extend",
        renewalDataMode: (resetData ? "reset" : "carry") as "reset" | "carry",
      };
      await apiClient.patch("/api/admin/renewal-settings", next);
      setSaved(next);
      toast.add({ title: "Renewal settings saved", type: "success" });
    } catch (error) {
      toast.add({
        title: "Could not save that",
        description:
          error instanceof Error
            ? error.message
            : "Your renewal settings are unchanged. Try again.",
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <SurfaceCard>
      <SurfaceCardHeader>
        <SurfaceCardTitle>Renewals</SurfaceCardTitle>
        <SurfaceCardDescription>
          What happens when a customer buys the same plan again before their
          current one runs out. These apply to all your plans.
        </SurfaceCardDescription>
      </SurfaceCardHeader>

      <SurfaceCardContent className="space-y-4">
        <div className="flex items-start justify-between gap-4 border-b pb-4">
          <div className="space-y-1">
            <Label htmlFor="renewal-expiry-reset" className="text-sm font-medium">
              Start the time again on renewal
            </Label>
            <p className="max-w-xl text-xs text-muted-foreground">
              Off, a renewal adds the plan to whatever time they had left, so
              topping up a 7 day plan with 2 days remaining runs for 9. On,
              the plan starts again from the moment they pay and the 2 days
              are lost. Customers are told which it will be before they pay.
            </p>
          </div>
          <Switch
            id="renewal-expiry-reset"
            checked={resetExpiry}
            disabled={!canEdit || saving}
            onCheckedChange={(checked) => setResetExpiry(Boolean(checked))}
          />
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="renewal-data-reset" className="text-sm font-medium">
              Start the data again on renewal
            </Label>
            <p className="max-w-xl text-xs text-muted-foreground">
              Off, unused data carries over, so renewing a 5GB plan with 2GB
              left gives 7GB. On, they get the plan&rsquo;s allowance and
              nothing more, and what they used before is cleared from the
              router. This also means a customer on an unlimited plan who
              renews onto a capped one is capped.
            </p>
          </div>
          <Switch
            id="renewal-data-reset"
            checked={resetData}
            disabled={!canEdit || saving}
            onCheckedChange={(checked) => setResetData(Boolean(checked))}
          />
        </div>
      </SurfaceCardContent>

      {canEdit && (
        <SurfaceCardFooter>
          <Button
            tone="field"
            scale="sm"
            onClick={save}
            disabled={saving || !dirty}
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </SurfaceCardFooter>
      )}
    </SurfaceCard>
  );
}
