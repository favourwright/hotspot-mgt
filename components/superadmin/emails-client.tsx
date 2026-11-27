"use client"

import { useMemo, useState } from "react"
import {
  EMAIL_AUDIENCE_LABELS,
  EMAIL_AUDIENCES,
  type EmailAudience,
  type EmailDefinition,
} from "@/lib/email-catalog"
import type { EmailSettings, EmailSwitch } from "@/types/schemas"
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
import { Eye, Plus, Send, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { toast } from "@/components/ui/toast"
import { auth } from "@/lib/firebase"

type SwitchMap = Record<string, EmailSwitch>

interface Preview {
  key: string
  name: string
  subject: string
  html: string
}

interface EmailsClientProps {
  catalog: readonly EmailDefinition[]
  initialSwitches: SwitchMap
  initialEmailSettings: EmailSettings
  mailtrapConfigured: boolean
}

export function EmailsClient({
  catalog,
  initialSwitches,
  initialEmailSettings,
  mailtrapConfigured,
}: EmailsClientProps) {
  const [switches, setSwitches] = useState<SwitchMap>(initialSwitches)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
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

  const liveCount = useMemo(
    () => catalog.filter((e) => switches[e.key]?.enabled).length,
    [catalog, switches]
  )

  const toggle = (key: string, enabled: boolean) => {
    setSwitches((prev) => ({ ...prev, [key]: { ...prev[key], enabled } }))
    setDirty((prev) => new Set(prev).add(key))
  }

  // Preview and test send share one endpoint: `send` also mails the rendered
  // email to the signed-in superadmin, whatever its switch says.
  const renderEmail = async (email: EmailDefinition, send: boolean) => {
    setBusyKey(email.key)
    try {
      if (!auth?.currentUser) throw new Error("Not authenticated")
      const token = await auth.currentUser.getIdToken()
      const response = await fetch("/api/superadmin/emails/preview", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ key: email.key, send }),
      })
      const data = await response.json()
      if (!data.success) throw new Error(data.error)

      if (send) {
        toast.add({
          title: "Test sent",
          description: `"${data.data.subject}" is on its way to ${data.data.sentTo}.`,
          type: "success",
        })
      } else {
        setPreview({
          key: email.key,
          name: email.name,
          subject: data.data.subject,
          html: data.data.html,
        })
      }
    } catch (err) {
      toast.add({
        title: send ? "Test send failed" : "Preview failed",
        description: err instanceof Error ? err.message : "Something went wrong",
        type: "error",
      })
    } finally {
      setBusyKey(null)
    }
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
      // switch another superadmin flipped while this page was open.
      const payload: Record<string, boolean> = {}
      for (const key of dirty) {
        payload[key] = switches[key]?.enabled ?? false
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
          ...(dirty.size > 0 ? { switches: payload } : {}),
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
        title: "Failed to save",
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
        description={`Choose which emails this platform sends - ${liveCount} of ${catalog.length} are on`}
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
          Every email is drawn in code and sent through Mailtrap, so there is
          nothing to set up in Mailtrap. An email that is off is skipped
          entirely, and a newly added email starts off. Preview one, or send
          yourself a test, before switching it on.
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
              {audience === "account" &&
                "About signing in, for customers and owners alike"}
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
              const locked = Boolean(email.alwaysOn)
              const enabled = locked || (switches[email.key]?.enabled ?? false)
              const busy = busyKey === email.key
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
                        {locked ? (
                          <Badge variant="secondary">Always sent</Badge>
                        ) : (
                          enabled && <Badge variant="secondary">On</Badge>
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
                        Send this email
                      </Label>
                      <Switch
                        id={`enabled-${email.key}`}
                        checked={enabled}
                        // Someone waiting on this to get back into their
                        // account; see `alwaysOn` in lib/email-catalog.ts.
                        disabled={locked}
                        onCheckedChange={(checked) =>
                          toggle(email.key, Boolean(checked))
                        }
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      tone="sunken"
                      scale="sm"
                      disabled={busy}
                      onClick={() => renderEmail(email, false)}
                    >
                      <Eye className="size-4" /> Preview
                    </Button>
                    <Button
                      tone="ghost"
                      scale="sm"
                      disabled={busy || !mailtrapConfigured}
                      onClick={() => renderEmail(email, true)}
                    >
                      <Send className="size-4" /> Send me a test
                    </Button>
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

      <Dialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) setPreview(null)
        }}
      >
        <DialogContent className="sm:max-w-170">
          <DialogHeader>
            <DialogTitle>{preview?.name}</DialogTitle>
            <DialogDescription>
              Subject: {preview?.subject}. Filled with sample values.
            </DialogDescription>
          </DialogHeader>
          {preview && (
            // A fixed height that scrolls inside the frame, so the footer
            // stays put without the usual scroll wrapper. Sandboxed with no
            // allowances: the markup is ours, but a preview has no business
            // running script or navigating the page.
            <iframe
              title={`Preview of ${preview.name}`}
              srcDoc={preview.html}
              sandbox=""
              className="h-[60vh] w-full rounded-2xl border border-border bg-white"
            />
          )}
          <DialogFooter className="mt-6">
            <Button tone="raised" onClick={() => setPreview(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
