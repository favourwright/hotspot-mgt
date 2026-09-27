"use client";

import { useState } from "react";
import { PlatformConfig } from "@/types/schemas";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/components/ui/toast";
import { auth } from "@/lib/firebase";

interface PlatformConfigClientProps {
  initialConfig: PlatformConfig;
}

function formatNaira(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString()}`;
}

export function PlatformConfigClient({
  initialConfig,
}: PlatformConfigClientProps) {
  const [config, setConfig] = useState(initialConfig);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const updateBillingPlan = (
    plan: keyof PlatformConfig["billingPlans"],
    field: string,
    value: string | number
  ) => {
    setConfig((prev) => ({
      ...prev,
      billingPlans: {
        ...prev.billingPlans,
        [plan]: {
          ...prev.billingPlans[plan],
          [field]: value,
        },
      },
    }));
  };

  const updateWireguard = (field: string, value: string) => {
    setConfig((prev) => ({
      ...prev,
      wireguard: {
        ...prev.wireguard,
        [field]: value,
      },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");

    try {
      if (!auth?.currentUser) throw new Error("Not authenticated");
      const token = await auth.currentUser.getIdToken();

      const response = await fetch("/api/platform/config", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          billingPlans: config.billingPlans,
          paystackBearer: config.paystackBearer,
          wireguard: config.wireguard,
        }),
      });

      const data = await response.json();
      if (!data.success) throw new Error(data.error);

      toast.add({
        title: "Config saved",
        description: "Platform configuration updated successfully.",
        type: "success",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save";
      setError(message);
      toast.add({
        title: "Failed to save config",
        description: message,
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const billingPlans = [
    {
      key: "pay-per-transaction" as const,
      label: "Pay Per Transaction",
    },
    {
      key: "subscription-only" as const,
      label: "Subscription Only",
    },
    {
      key: "hybrid" as const,
      label: "Hybrid",
    },
  ];

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Billing Plans */}
      <Card className="p-6">
        <h2 className="font-semibold mb-4">Billing Plans</h2>
        <div className="space-y-6">
          {billingPlans.map(({ key, label }) => (
            <div key={key}>
              <h3 className="text-sm font-medium mb-3">{label}</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs">Monthly Fee (kobo)</Label>
                  <Input
                    type="number"
                    value={config.billingPlans[key].monthlyFee}
                    onChange={(e) =>
                      updateBillingPlan(
                        key,
                        "monthlyFee",
                        Number(e.target.value)
                      )
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    = {formatNaira(config.billingPlans[key].monthlyFee)}
                  </p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Platform Fee %</Label>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={config.billingPlans[key].platformFeePercent}
                    onChange={(e) =>
                      updateBillingPlan(
                        key,
                        "platformFeePercent",
                        Number(e.target.value)
                      )
                    }
                  />
                </div>
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs">Description</Label>
                  <Input
                    value={config.billingPlans[key].description}
                    onChange={(e) =>
                      updateBillingPlan(key, "description", e.target.value)
                    }
                  />
                </div>
              </div>
              <Separator className="mt-4" />
            </div>
          ))}
        </div>
      </Card>

      {/* WireGuard Config */}
      <Card className="p-6">
        <h2 className="font-semibold mb-4">WireGuard Server</h2>
        <div className="space-y-4">
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
        </div>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button onClick={handleSave} disabled={saving} className="w-full">
        {saving ? "Saving..." : "Save Configuration"}
      </Button>
    </div>
  );
}
