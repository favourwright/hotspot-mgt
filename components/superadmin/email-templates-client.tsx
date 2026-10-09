"use client"

import { useMemo, useState } from "react"
import {
  EMAIL_AUDIENCE_LABELS,
  EMAIL_AUDIENCES,
  type EmailAudience,
  type EmailDefinition,
} from "@/lib/email-catalog"
import type { EmailSettings, EmailTemplateSetting } from "@/types/schemas"
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
import { Plus, X } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { toast } from "@/components/ui/toast"
import { auth } from "@/lib/firebase"

type SettingsMap = Record<string, EmailTemplateSetting>

interface EmailTemplatesClientProps {
  catalog: readonly EmailDefinition[]
  initialSettings: SettingsMap
  initialEmailSettings: EmailSettings
  mailtrapConfigured: boolean
}

export function EmailTemplatesClient({
  catalog,
  initialSettings,
  initialEmailSettings,
  mailtrapConfigured,
}: EmailTemplatesClientProps) {
  const [settings, setSettings] = useState<SettingsMap>(initialSettings)
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [recipients, setRecipients] = useState<string[]>(
    initialEmailSettings.alertRecipients.length > 0
      ? initialEmailSettings.alertRecipients
      : [""]
  )
  const [supportEmail, setSupportEmail] = useState(
    initialEmailSettings.supportEmail
  )
  const [settingsDirty, setSettingsDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const grouped = useMemo(() => {
    return EMAIL_AUDIENCES.map((audience) => ({
      audience,
      emails: catalog.filter((e) => e.audience === audience),
    })).filter((group) => group.emails.length > 0)
  }, [catalog])

  const configuredCount = useMemo(
    () =>
      catalog.filter((e) => settings[e.key]?.templateId && settings[e.key]?.enabled)
        .length,
    [catalog, settings]
  )

  const update = (key: string, patch: Partial<EmailTemplateSetting>) => {
    setSettings((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }))
    setDirty((prev) => new Set(prev).add(key))
  }

  const updateRecipient = (index: number, value: string) => {
    setRecipients((prev) => prev.map((r, i) => (i === index ? value : r)))
    setSettingsDirty(true)
  }

  const addRecipient = () => {
    setRecipients((prev) => [...prev, ""])
    setSettingsDirty(true)
  }

  const removeRecipient = (index: number) => {
    setRecipients((prev) => {
      const next = prev.filter((_, i) => i !== index)
      return next.length > 0 ? next : [""]
    })
    setSettingsDirty(true)
  }

  const handleSave = async () => {
    if (dirty.size === 0 && !settingsDirty) return
    setSaving(true)
    setError("")

    try {
      if (!auth?.currentUser) throw new Error("Not authenticated")
      const token = await auth.currentUser.getIdToken()

      // Only the rows that actually changed - a full map would overwrite a
      // template ID another superadmin saved while this page was open.
      const payload: Record<string, { templateId: string; enabled: boolean }> = {}
      for (const key of dirty) {
        payload[key] = {
          templateId: settings[key]?.templateId ?? "",
          enabled: settings[key]?.enabled ?? true,
        }
      }

      const cleanedRecipients = recipients
        .map((r) => r.trim())
        .filter((r) => r.length > 0)

      if (settingsDirty && cleanedRecipients.length === 0) {
        throw new Error(
          "Add at least one alert recipient, or platform alerts reach nobody"
        )
      }

      const response = await fetch("/api/superadmin/emails", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...(dirty.size > 0 ? { templates: payload } : {}),
          ...(settingsDirty
            ? {
                settings: {
                  alertRecipients: cleanedRecipients,
                  supportEmail: supportEmail.trim(),
                },
              }
            : {}),
        }),
      })

      const data = await response.json()
      if (!data.success) throw new Error(data.error)

      setDirty(new Set())
      setSettingsDirty(false)
      toast.add({
        title: "Saved",
        description:
          dirty.size > 0
            ? `${dirty.size} email${dirty.size === 1 ? "" : "s"} updated.`
            : "Recipient settings updated.",
        type: "success",
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save"
      setError(message)
      toast.add({
        title: "Failed to save templates",
        description: message,
        type: "error",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Emails"
        description={`Map each email this platform sends onto a Mailtrap template - ${configuredCount} of ${catalog.length} are live`}
        action={
          <Button
            tone="action"
            onClick={handleSave}
            disabled={saving || (dirty.size === 0 && !settingsDirty)}
          >
            {saving
              ? "Saving..."
              : dirty.size > 0
                ? `Save ${dirty.size} change${dirty.size === 1 ? "" : "s"}`
                : settingsDirty
                  ? "Save settings"
                  : "Save changes"}
          </Button>
        }
      />

      {!mailtrapConfigured && (
        <Alert variant="destructive">
          <AlertDescription>
            Mailtrap is not configured on this deployment, so nothing is being
            sent regardless of what is set below. Set{" "}
            <code className="font-mono text-xs">MAILTRAP_API_TOKEN</code> and{" "}
            <code className="font-mono text-xs">MAILTRAP_SENDER_EMAIL</code> in
            the environment, then restart the service.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Alert>
        <AlertDescription>
          An email with no template ID is skipped, never sent blank. Paste the
          template UUID from Mailtrap (Email Templates &rarr; the template &rarr;
          its UUID), and build that template against the variables listed on
          each row.
        </AlertDescription>
      </Alert>

      <SurfaceCard>
        <SurfaceCardHeader>
          <SurfaceCardTitle>Recipients</SurfaceCardTitle>
          <SurfaceCardDescription>
            Who operational alerts reach, and the address users are told to
            contact. Changing either takes effect on the next send, with no
            deploy or restart.
          </SurfaceCardDescription>
        </SurfaceCardHeader>
        <SurfaceCardContent className="space-y-6">
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-sm font-medium">Platform alert recipients</Label>
              <p className="text-xs text-muted-foreground">
                Everyone here receives the {EMAIL_AUDIENCE_LABELS.platform}{" "}
                emails below, as one message with several recipients. Leave none
                and alerts fall back to the PLATFORM_ALERT_EMAIL environment
                variable rather than going nowhere.
              </p>
            </div>

            {recipients.map((recipient, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  type="email"
                  value={recipient}
                  placeholder="alerts@example.com"
                  onChange={(e) => updateRecipient(index, e.target.value)}
                  className="text-sm"
                />
                <Button
                  tone="ghost"
                  onClick={() => removeRecipient(index)}
                  aria-label={`Remove recipient ${index + 1}`}
                  disabled={recipients.length === 1 && !recipients[0]}
                >
                  <X className="size-4" />
                </Button>
              </div>
            ))}

            <Button tone="ghost" onClick={addRecipient}>
              <Plus className="size-4" /> Add recipient
            </Button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="support-email" className="text-sm font-medium">
              Support address shown to users
            </Label>
            <p className="text-xs text-muted-foreground">
              Passed to every template as{" "}
              <code className="font-mono text-[11px]">support_email</code>. This
              is what a customer is told to write to, so it is usually a
              monitored inbox rather than an alert list.
            </p>
            <Input
              id="support-email"
              type="email"
              value={supportEmail}
              placeholder="support@example.com"
              onChange={(e) => {
                setSupportEmail(e.target.value)
                setSettingsDirty(true)
              }}
              className="text-sm"
            />
          </div>
        </SurfaceCardContent>
      </SurfaceCard>

      {grouped.map(({ audience, emails }) => (
        <SurfaceCard key={audience}>
          <SurfaceCardHeader>
            <SurfaceCardTitle>
              {EMAIL_AUDIENCE_LABELS[audience as EmailAudience]}
            </SurfaceCardTitle>
            <SurfaceCardDescription>
              {audience === "customer" &&
                "Sent to the people buying vouchers on a tenant's portal"}
              {audience === "owner" &&
                "Sent to the tenant who owns the hotspot business"}
              {audience === "platform" &&
                "Operational alerts, sent to PLATFORM_ALERT_EMAIL (or SUPERADMIN_EMAIL)"}
            </SurfaceCardDescription>
          </SurfaceCardHeader>
          <SurfaceCardContent className="space-y-6">
            {emails.map((email) => {
              const setting = settings[email.key] ?? {
                templateId: "",
                enabled: true,
                updatedAt: null,
              }
              const isDirty = dirty.has(email.key)

              return (
                <div
                  key={email.key}
                  className="space-y-3 border-b border-border pb-6 last:border-0 last:pb-0"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{email.name}</span>
                        {email.status === "planned" && (
                          <Badge variant="outline">Not wired yet</Badge>
                        )}
                        {setting.templateId && setting.enabled && (
                          <Badge variant="secondary">Live</Badge>
                        )}
                        {isDirty && <Badge variant="outline">Unsaved</Badge>}
                      </div>
                      <p className="max-w-2xl text-xs text-muted-foreground">
                        {email.description}
                      </p>
                      <p className="font-mono text-[11px] text-muted-foreground">
                        {email.key} &middot; {email.trigger}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <Label
                        htmlFor={`enabled-${email.key}`}
                        className="text-xs text-muted-foreground"
                      >
                        Enabled
                      </Label>
                      <Switch
                        id={`enabled-${email.key}`}
                        checked={setting.enabled}
                        onCheckedChange={(checked) =>
                          update(email.key, { enabled: Boolean(checked) })
                        }
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={`template-${email.key}`} className="text-xs">
                      Mailtrap template ID
                    </Label>
                    <Input
                      id={`template-${email.key}`}
                      value={setting.templateId}
                      placeholder="e.g. 3f1b2c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d"
                      onChange={(e) =>
                        update(email.key, { templateId: e.target.value })
                      }
                      className="font-mono text-xs"
                    />
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {email.variables.map((variable) => (
                      <code
                        key={variable}
                        className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                      >
                        {variable}
                      </code>
                    ))}
                  </div>
                </div>
              )
            })}
          </SurfaceCardContent>
        </SurfaceCard>
      ))}
    </div>
  )
}
