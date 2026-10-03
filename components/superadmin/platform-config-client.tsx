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
import { Button } from "@/components/system/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { toast } from "@/components/ui/toast"
import { auth } from "@/lib/firebase"

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
    <div className="max-w-2xl space-y-6">
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

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button
        tone="accent"
        onClick={handleSave}
        disabled={saving}
        className="w-full"
      >
        {saving ? "Saving..." : "Save configuration"}
      </Button>
    </div>
  )
}
