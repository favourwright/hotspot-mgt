"use client";

import { useState } from "react";

import { apiClient } from "@/lib/api-client";
import type { NotificationSetting } from "@/lib/notification-prefs";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card";

/**
 * The owner's own email switches.
 *
 * Saves on toggle rather than behind a Save button: there is one field per
 * row and nothing to review, so a button would only add a way to lose the
 * change by navigating away. The switch moves immediately and reverts if the
 * request fails - a preference that silently didn't save is worse than a
 * slower one, because the owner finds out weeks later via an inbox that
 * never went quiet.
 *
 * Only emails the catalog marks `optional` ever reach this list. Anything
 * operational - a failed voucher, an offline router, a billing problem -
 * deliberately has no switch, since muting those means not finding out the
 * business has stopped working.
 */
export function NotificationSettings({
  initial,
}: {
  initial: NotificationSetting[];
}) {
  const [settings, setSettings] = useState(initial);
  const [saving, setSaving] = useState<string | null>(null);

  async function toggle(key: string, enabled: boolean) {
    const previous = settings;
    const next = settings.map((s) => (s.key === key ? { ...s, enabled } : s));

    setSettings(next);
    setSaving(key);

    try {
      await apiClient.patch("/api/admin/notifications", {
        // The whole set, not just the one that changed - the server replaces
        // the stored list outright, so a partial payload would read as
        // "switch everything else back on".
        settings: Object.fromEntries(next.map((s) => [s.key, s.enabled])),
      });
    } catch (error) {
      setSettings(previous);
      toast.add({
        title: "Could not save that",
        description:
          error instanceof Error
            ? error.message
            : "Your notification settings are unchanged. Try again.",
        type: "error",
      });
    } finally {
      setSaving(null);
    }
  }

  if (settings.length === 0) return null;

  return (
    <SurfaceCard>
      <SurfaceCardHeader>
        <SurfaceCardTitle>Email notifications</SurfaceCardTitle>
        <SurfaceCardDescription>
          Choose what we email you about. Alerts about failed sales, offline
          routers and your billing are always sent.
        </SurfaceCardDescription>
      </SurfaceCardHeader>
      <SurfaceCardContent className="space-y-4">
        {settings.map((setting) => (
          <div
            key={setting.key}
            className="flex items-start justify-between gap-4 border-b pb-4 last:border-0 last:pb-0"
          >
            <div className="space-y-1">
              <Label
                htmlFor={`notify-${setting.key}`}
                className="text-sm font-medium"
              >
                {setting.label}
              </Label>
              <p className="max-w-xl text-xs text-muted-foreground">
                {setting.help}
              </p>
            </div>
            <Switch
              id={`notify-${setting.key}`}
              checked={setting.enabled}
              disabled={saving === setting.key}
              onCheckedChange={(checked) =>
                toggle(setting.key, Boolean(checked))
              }
            />
          </div>
        ))}
      </SurfaceCardContent>
    </SurfaceCard>
  );
}
