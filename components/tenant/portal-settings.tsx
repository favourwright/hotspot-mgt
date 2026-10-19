"use client";

import { useState } from "react";

import { apiClient } from "@/lib/api-client";
import { formatLocalPhone, normalizeNigerianPhone } from "@/lib/phone";
import { Button } from "@/components/system/button";
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardFooter,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";

interface PortalSettingsProps {
  initial: {
    portalMacNotice: boolean;
    supportPhone: string | null;
    supportPhoneIsWhatsapp: boolean;
  };
  /**
   * False for a superadmin viewing someone else's settings. The API refuses
   * the write regardless; this stops offering an action that would be
   * refused, the same as NotificationSettings.
   */
  canEdit: boolean;
}

/**
 * What the tenant puts on their captive portal.
 *
 * Saved behind a button rather than on change, which is the one deliberate
 * difference from `notification-settings.tsx` next to it. That component's
 * rows are independent switches with nothing to review, so a button would
 * only add a way to lose the change. Here the number is a text field that
 * needs an explicit commit, and the WhatsApp switch is meaningless without
 * it - saving them separately invites a state where the switch is on and
 * the number is half-typed.
 */
export function PortalSettings({ initial, canEdit }: PortalSettingsProps) {
  const [macNotice, setMacNotice] = useState(initial.portalMacNotice);
  // The local part only: the `+234` lives in the addon beside it, and
  // repeating it in the value reads as a typo.
  const [phone, setPhone] = useState(
    initial.supportPhone ? formatLocalPhone(initial.supportPhone) : ""
  );
  const [isWhatsapp, setIsWhatsapp] = useState(initial.supportPhoneIsWhatsapp);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(initial);

  const trimmed = phone.trim();
  const normalized = trimmed ? normalizeNigerianPhone(trimmed) : null;
  // Only once they have typed enough to be wrong. Complaining at the first
  // digit is a form telling someone off for not having finished.
  const invalid = trimmed.length >= 10 && !normalized;

  const dirty =
    macNotice !== saved.portalMacNotice ||
    (normalized ?? null) !== (saved.supportPhone ?? null) ||
    (normalized ? isWhatsapp : false) !== saved.supportPhoneIsWhatsapp;

  async function save() {
    setSaving(true);
    try {
      const next = {
        portalMacNotice: macNotice,
        supportPhone: trimmed,
        supportPhoneIsWhatsapp: isWhatsapp,
      };
      await apiClient.patch("/api/admin/portal-settings", next);

      setSaved({
        portalMacNotice: macNotice,
        supportPhone: normalized,
        supportPhoneIsWhatsapp: normalized ? isWhatsapp : false,
      });
      if (!normalized) setIsWhatsapp(false);

      toast.add({ title: "Portal settings saved", type: "success" });
    } catch (error) {
      toast.add({
        title: "Could not save that",
        description:
          error instanceof Error
            ? error.message
            : "Your portal settings are unchanged. Try again.",
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <SurfaceCard>
      <SurfaceCardHeader>
        <SurfaceCardTitle>Captive portal</SurfaceCardTitle>
        <SurfaceCardDescription>
          What your customers see on the Wi-Fi sign-in page.
        </SurfaceCardDescription>
      </SurfaceCardHeader>

      <SurfaceCardContent className="space-y-4">
        <div className="flex items-start justify-between gap-4 border-b pb-4">
          <div className="space-y-1">
            <Label htmlFor="portal-mac-notice" className="text-sm font-medium">
              Show the private Wi-Fi address notice
            </Label>
            <p className="max-w-xl text-xs text-muted-foreground">
              Tells customers that a private or random Wi-Fi address can make
              this network treat their phone as a new device each time. Turn it
              on if your customers have trouble staying connected.
            </p>
          </div>
          <Switch
            id="portal-mac-notice"
            checked={macNotice}
            disabled={!canEdit || saving}
            onCheckedChange={(checked) => setMacNotice(Boolean(checked))}
          />
        </div>

        <div className="space-y-2 border-b pb-4">
          <Label htmlFor="portal-support-phone" className="text-sm font-medium">
            Support number
          </Label>
          <InputGroup>
            <InputGroupAddon>
              <InputGroupText>+234</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              id="portal-support-phone"
              inputMode="tel"
              autoComplete="tel-national"
              placeholder="803 123 4567"
              className="pl-0.5!"
              value={phone}
              disabled={!canEdit || saving}
              aria-invalid={invalid || undefined}
              onChange={(event) => setPhone(event.target.value)}
            />
          </InputGroup>
          <p className="max-w-xl text-xs text-muted-foreground">
            {invalid
              ? "That doesn't look like a Nigerian mobile number. Enter it as 803 123 4567."
              : "Shown on your sign-in page so customers who cannot get online can still reach you. This is published publicly. Leave it empty to show nothing."}
          </p>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="portal-whatsapp" className="text-sm font-medium">
              This number is on WhatsApp
            </Label>
            <p className="max-w-xl text-xs text-muted-foreground">
              Adds a WhatsApp button beside it with a message already written.
              The customer will only be able to send it once they are online or
              on mobile data.
            </p>
          </div>
          <Switch
            id="portal-whatsapp"
            checked={isWhatsapp}
            // Nothing for the icon to link to without a number, and a switch
            // left on would quietly re-enable it the moment one was typed.
            disabled={!canEdit || saving || !normalized}
            onCheckedChange={(checked) => setIsWhatsapp(Boolean(checked))}
          />
        </div>
      </SurfaceCardContent>

      {canEdit && (
        <SurfaceCardFooter>
          <Button
            tone="field"
            scale="sm"
            onClick={save}
            disabled={saving || !dirty || invalid}
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </SurfaceCardFooter>
      )}
    </SurfaceCard>
  );
}
