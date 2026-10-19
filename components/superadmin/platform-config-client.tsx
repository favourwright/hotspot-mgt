"use client"

import { useState } from "react"
import { PlatformConfig } from "@/types/schemas"
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/system/button"
import { PageHeader } from "@/components/system/page-header"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { toast } from "@/components/ui/toast"
import { auth } from "@/lib/firebase"

const koboToNaira = (kobo: number) => String(kobo / 100)
const nairaToKobo = (naira: string) => Math.round(Number(naira || 0) * 100)

interface PlatformConfigClientProps {
  initialConfig: PlatformConfig
}

export function PlatformConfigClient({
  initialConfig,
}: PlatformConfigClientProps) {
  const [config, setConfig] = useState(initialConfig)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const updateWireguard = (field: string, value: string) => {
    setConfig((prev) => ({
      ...prev,
      wireguard: {
        ...prev.wireguard,
        [field]: value,
      },
    }))
  }

  const updateFeePassthrough = <K extends keyof PlatformConfig["paystackFeePassthrough"]>(
    field: K,
    value: PlatformConfig["paystackFeePassthrough"][K]
  ) => {
    setConfig((prev) => ({
      ...prev,
      paystackFeePassthrough: {
        ...prev.paystackFeePassthrough,
        [field]: value,
      },
    }))
  }

  const handleSave = async () => {
    setSaving(true)
    setError("")

    try {
      if (!auth?.currentUser) throw new Error("Not authenticated")
      const token = await auth.currentUser.getIdToken()

      const response = await fetch("/api/platform/config", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          paystackBearer: config.paystackBearer,
          wireguard: config.wireguard,
          paystackFeePassthrough: config.paystackFeePassthrough,
          planFeeGraceDays: config.planFeeGraceDays,
        }),
      })

      const data = await response.json()
      if (!data.success) throw new Error(data.error)

      toast.add({
        title: "Config saved",
        description: "Platform configuration updated successfully.",
        type: "success",
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save"
      setError(message)
      toast.add({
        title: "Failed to save config",
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
        title="Platform config"
        description="WireGuard settings, Paystack fee defaults and the unpaid-fee grace window - billing plans now live under Billing plans"
        action={
          <Button tone="action" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save configuration"}
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:items-start">
        <SurfaceCard>
          <SurfaceCardHeader>
            <SurfaceCardTitle>Payment processing fees</SurfaceCardTitle>
            <SurfaceCardDescription>
              Pass Paystack&apos;s processing fee on to whoever is paying, instead of it
              coming out of the platform&apos;s or tenant&apos;s settlement
            </SurfaceCardDescription>
          </SurfaceCardHeader>
          <SurfaceCardContent className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label>Pass fee to the payer</Label>
                <p className="text-xs text-muted-foreground">
                  Customers cover it on voucher purchases, tenants cover it on their
                  own subscription payments. New signups only - never changes what an
                  already-active tenant is charged.
                </p>
              </div>
              <Switch
                checked={config.paystackFeePassthrough.enabled}
                onCheckedChange={(checked) => updateFeePassthrough("enabled", checked)}
              />
            </div>

            {config.paystackFeePassthrough.enabled && (
              <>
                <p className="text-xs text-muted-foreground">
                  Estimates against Paystack&apos;s published local-card rate - there&apos;s
                  no API to ask Paystack the exact fee in advance, and it genuinely
                  varies by payment channel. Any gap between this estimate and
                  Paystack&apos;s real fee is absorbed by the platform&apos;s own margin,
                  never by what a tenant actually receives.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Percentage (%)</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step="0.1"
                      value={config.paystackFeePassthrough.percent}
                      onChange={(e) =>
                        updateFeePassthrough("percent", Number(e.target.value || 0))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Flat Fee (₦)</Label>
                    <Input
                      type="number"
                      min={0}
                      value={koboToNaira(config.paystackFeePassthrough.flatFeeKobo)}
                      onChange={(e) =>
                        updateFeePassthrough("flatFeeKobo", nairaToKobo(e.target.value))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Fee Cap (₦)</Label>
                    <Input
                      type="number"
                      min={0}
                      value={koboToNaira(config.paystackFeePassthrough.capKobo)}
                      onChange={(e) =>
                        updateFeePassthrough("capKobo", nairaToKobo(e.target.value))
                      }
                    />
                    <p className="text-xs text-muted-foreground">0 = no cap</p>
                  </div>
                  <div className="space-y-1">
                    <Label>Waive Flat Fee Below (₦)</Label>
                    <Input
                      type="number"
                      min={0}
                      value={koboToNaira(config.paystackFeePassthrough.waiveFlatFeeBelowKobo)}
                      onChange={(e) =>
                        updateFeePassthrough(
                          "waiveFlatFeeBelowKobo",
                          nairaToKobo(e.target.value)
                        )
                      }
                    />
                  </div>
                </div>
              </>
            )}
          </SurfaceCardContent>
        </SurfaceCard>

        <SurfaceCard>
          <SurfaceCardHeader>
            <SurfaceCardTitle>WireGuard server</SurfaceCardTitle>
            <SurfaceCardDescription>
              How tenant routers reach the VPS tunnel
            </SurfaceCardDescription>
          </SurfaceCardHeader>
          <SurfaceCardContent className="space-y-4">
            <div className="space-y-1">
              <Label>Server Public Key</Label>
              <Input
                value={config.wireguard.serverPublicKey}
                onChange={(e) =>
                  updateWireguard("serverPublicKey", e.target.value)
                }
                placeholder="VPS WireGuard public key"
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label>Server Endpoint (IP)</Label>
              <Input
                value={config.wireguard.serverEndpoint}
                onChange={(e) =>
                  updateWireguard("serverEndpoint", e.target.value)
                }
                placeholder="193.123.183.184"
              />
            </div>
            <div className="space-y-1">
              <Label>Tunnel Subnet</Label>
              <Input
                value={config.wireguard.tunnelSubnet}
                onChange={(e) => updateWireguard("tunnelSubnet", e.target.value)}
                placeholder="10.10.10.0/24"
              />
            </div>
          </SurfaceCardContent>
        </SurfaceCard>

        <SurfaceCard>
          <SurfaceCardHeader>
            <SurfaceCardTitle>Unpaid plan fees</SurfaceCardTitle>
            <SurfaceCardDescription>
              How long a tenant keeps selling after their plan fee falls due
            </SurfaceCardDescription>
          </SurfaceCardHeader>
          <SurfaceCardContent className="space-y-4">
            <div className="space-y-1">
              <Label>Grace period (days)</Label>
              <Input
                type="number"
                min={0}
                max={365}
                value={config.planFeeGraceDays}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    planFeeGraceDays: Math.max(
                      0,
                      Math.round(Number(e.target.value || 0))
                    ),
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">
                Counted from the moment the fee is owed - the day a trial or
                promo closes, or a subscription lapses - not from when we
                emailed about it. 0 pauses them the same day.
              </p>
            </div>
            {/* The consequence spelled out, because the number on its own
                reads like a reminder setting rather than the switch that
                stops a tenant taking money. */}
            <p className="text-xs text-muted-foreground">
              After that, new voucher sales stop and the owner can&apos;t change
              their setup until they pay or move to a cheaper plan. Vouchers
              already sold keep working, and the dashboard stays readable.
              Applies immediately to every tenant already past due, so
              shortening it can pause accounts today.
            </p>
          </SurfaceCardContent>
        </SurfaceCard>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
