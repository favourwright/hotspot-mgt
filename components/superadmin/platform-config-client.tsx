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
import { formatDate } from "@/lib/utils"

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

  const updateFeePassthrough = <K extends keyof PlatformConfig["processingFeePassthrough"]>(
    field: K,
    value: PlatformConfig["processingFeePassthrough"][K]
  ) => {
    setConfig((prev) => ({
      ...prev,
      processingFeePassthrough: {
        ...prev.processingFeePassthrough,
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
          feeBearer: config.feeBearer,
          wireguard: config.wireguard,
          processingFeePassthrough: config.processingFeePassthrough,
          planFeeGraceDays: config.planFeeGraceDays,
          voucherGeneration: config.voucherGeneration,
          requireServerCheckout: config.serverCheckoutRequiredSince !== null,
        }),
      })

      const data = await response.json()
      if (!data.success) throw new Error(data.error)
      // The server stamps the moment enforcement started; keep its value
      // rather than the placeholder the switch set.
      setConfig((prev) => ({
        ...prev,
        serverCheckoutRequiredSince: data.data.serverCheckoutRequiredSince
          ? new Date(data.data.serverCheckoutRequiredSince)
          : null,
      }))

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
        description="WireGuard settings, payment fee defaults and the unpaid-fee grace window - billing plans now live under Billing plans"
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
              Pass the payment provider&apos;s processing fee on to whoever is paying,
              instead of it coming out of the platform&apos;s or tenant&apos;s share
            </SurfaceCardDescription>
          </SurfaceCardHeader>
          <SurfaceCardContent className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label>Pass fee to the payer</Label>
                <p className="text-xs text-muted-foreground">
                  Customers cover it on voucher purchases, tenants cover it on their
                  plan and addon payments. Applies to payments started from now on.
                </p>
              </div>
              <Switch
                checked={config.processingFeePassthrough.enabled}
                onCheckedChange={(checked) => updateFeePassthrough("enabled", checked)}
              />
            </div>

            {config.processingFeePassthrough.enabled && (
              <>
                <p className="text-xs text-muted-foreground">
                  A formula, not the real fee: Monnify&apos;s fee is only known after the
                  charge, and it varies by payment channel. Any gap between this
                  estimate and the real fee falls on whoever bears the fee, never on
                  the other side&apos;s share.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Percentage (%)</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step="0.1"
                      value={config.processingFeePassthrough.percent}
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
                      value={koboToNaira(config.processingFeePassthrough.flatFeeKobo)}
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
                      value={koboToNaira(config.processingFeePassthrough.capKobo)}
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
                      value={koboToNaira(config.processingFeePassthrough.waiveFlatFeeBelowKobo)}
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
            <SurfaceCardTitle>Voucher generation</SurfaceCardTitle>
            <SurfaceCardDescription>
              Guard rails for tenants printing their own codes. How many a
              tenant may generate comes from their billing plan and credits;
              these bound any single request and any single router.
            </SurfaceCardDescription>
          </SurfaceCardHeader>
          <SurfaceCardContent className="space-y-4">
            {(
              [
                {
                  key: "maxBatchSize",
                  label: "Most codes in one batch",
                  min: 1,
                  max: 500,
                  help: "Up to 500. A batch is written to the router one code at a time, so larger batches take longer to finish.",
                },
                {
                  key: "maxUnusedPerRouter",
                  label: "Most unused codes on one router",
                  min: 1,
                  max: 10000,
                  help: "Up to 10,000. Unused codes sit on the router as hotspot users until someone logs in or the owner voids them.",
                },
                {
                  key: "minCreditPurchase",
                  label: "Fewest credits in one online purchase",
                  min: 1,
                  max: 10000,
                  help: "Keeps tiny purchases from costing more in processing fees than they are worth.",
                },
              ] as const
            ).map(({ key, label, min, max, help }) => (
              <div key={key} className="space-y-1">
                <Label>{label}</Label>
                <Input
                  type="number"
                  min={min}
                  max={max}
                  value={config.voucherGeneration[key]}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      voucherGeneration: {
                        ...prev.voucherGeneration,
                        [key]: Math.min(
                          max,
                          Math.max(min, Math.round(Number(e.target.value || min)))
                        ),
                      },
                    }))
                  }
                />
                <p className="text-xs text-muted-foreground">{help}</p>
              </div>
            ))}
            <div className="space-y-1">
              <Label>Price of one top-up credit (₦)</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={config.voucherGeneration.creditPriceKobo / 100}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    voucherGeneration: {
                      ...prev.voucherGeneration,
                      creditPriceKobo: Math.max(0, Math.round(Number(e.target.value || 0) * 100)),
                    },
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">
                What tenants pay per code when they buy credits on their Generate codes page, plus
                the processing fee if it is passed on. 0 keeps credits off sale, and tenants are
                told to contact you.
              </p>
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

        <SurfaceCard>
          <SurfaceCardHeader>
            <SurfaceCardTitle>Voucher checkout</SurfaceCardTitle>
            <SurfaceCardDescription>
              Whether a voucher charge has to have been started by this server
            </SurfaceCardDescription>
          </SurfaceCardHeader>
          <SurfaceCardContent className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label>Require server-started checkout</Label>
                <p className="text-xs text-muted-foreground">
                  {config.serverCheckoutRequiredSince
                    ? `On since ${formatDate(config.serverCheckoutRequiredSince)}.`
                    : "Off. Every successful charge is fulfilled the way it always was."}
                </p>
              </div>
              <Switch
                checked={config.serverCheckoutRequiredSince !== null}
                onCheckedChange={(checked) =>
                  setConfig((prev) => ({
                    ...prev,
                    serverCheckoutRequiredSince: checked
                      ? (prev.serverCheckoutRequiredSince ?? new Date())
                      : null,
                  }))
                }
              />
            </div>
            {/* What switching it on does to real money, said plainly. */}
            <p className="text-xs text-muted-foreground">
              Once on, a paid charge our server never started goes to Payment
              reviews instead of becoming a voucher. Switch it on about an hour
              after deploying server-side checkout, so nobody with the old page
              still open is caught. Charges paid before the moment it was
              switched on are always honoured.
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
