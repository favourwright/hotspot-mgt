"use client";

import { useState, FormEvent } from "react";
import { useCreateLocation } from "@/hooks/use-locations";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "@/components/ui/toast";
import { Copy, CheckCircle, Loader2, AlertTriangle } from "lucide-react";
import { auth } from "@/lib/firebase";

interface AddLocationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

type WgPhase = "get-key" | "run-commands" | "verify";

export function AddLocationDialog({
  open,
  onOpenChange,
  onSuccess,
}: AddLocationDialogProps) {
  // Common fields
  const [name, setName] = useState("");
  const [routerUser, setRouterUser] = useState("");
  const [routerPass, setRouterPass] = useState("");
  const [error, setError] = useState("");

  // Direct IP fields
  const [routerIp, setRouterIp] = useState("");

  // WireGuard fields
  const [wgPhase, setWgPhase] = useState<WgPhase>("get-key");
  const [wgPublicKey, setWgPublicKey] = useState("");
  const [wgAssignedIp, setWgAssignedIp] = useState("");
  const [wgCommands, setWgCommands] = useState<string[]>([]);
  const [wgNote, setWgNote] = useState<string | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [polling, setPolling] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const createLocation = useCreateLocation();

  const resetForm = () => {
    setName("");
    setRouterIp("");
    setRouterUser("");
    setRouterPass("");
    setError("");
    setWgPhase("get-key");
    setWgPublicKey("");
    setWgAssignedIp("");
    setWgCommands([]);
    setWgNote(null);
  };

  const copyToClipboard = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  };

  const handleProvision = async () => {
    if (!wgPublicKey.trim()) {
      setError("Please enter the router's WireGuard public key");
      return;
    }

    setProvisioning(true);
    setError("");

    try {
      if (!auth || !auth.currentUser) {
        throw new Error("Not authenticated");
      }
      const token = await auth.currentUser.getIdToken();

      const response = await fetch("/api/admin/locations/provision", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          publicKey: wgPublicKey.trim(),
          locationName: name,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to provision WireGuard peer");
      }

      setWgAssignedIp(data.data.assignedIp);
      setWgCommands(data.data.commands);
      setWgNote(data.data.note);
      setWgPhase("run-commands");
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to provision";
      setError(errorMessage);
    } finally {
      setProvisioning(false);
    }
  };

  const pollConnection = async (
    assignedIp: string,
    maxAttempts = 20
  ): Promise<boolean> => {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        if (!auth || !auth.currentUser) {
          return false;
        }
        const token = await auth.currentUser.getIdToken();

        const response = await fetch(
          `/api/admin/locations/tunnel-status/${assignedIp}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        const data = await response.json();

        if (data.success && data.data?.reachable) {
          return true;
        }

        await new Promise((resolve) => setTimeout(resolve, 3000));
      } catch (error) {
        console.error("Poll error:", error);
      }
    }
    return false;
  };

  const handleVerifyConnection = async () => {
    if (!name || !routerUser || !routerPass) {
      setError("Please fill in all fields");
      return;
    }

    setPolling(true);
    setError("");
    setWgPhase("verify");

    try {
      const reachable = await pollConnection(wgAssignedIp);

      if (!reachable) {
        setError(
          "Could not connect to your router. Please verify you ran all the commands correctly."
        );
        setWgPhase("run-commands");
        return;
      }

      // Router is reachable - save location
      await createLocation.mutateAsync({
        name,
        routerIp: wgAssignedIp,
        routerUser,
        routerPass,
        wireguardPublicKey: wgPublicKey.trim(),
        wireguardTunnelIp: wgAssignedIp,
        connectionMethod: "wireguard",
        active: true,
      });

      toast.add({
        title: "Location created",
        description: "Router connected via WireGuard and location saved successfully.",
        type: "success",
      });

      onSuccess();
      onOpenChange(false);
      resetForm();
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to create location";
      setError(errorMessage);
      setWgPhase("run-commands");

      toast.add({
        title: "Failed to create location",
        description: errorMessage,
        type: "error",
      });
    } finally {
      setPolling(false);
    }
  };

  const handleDirectSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (!name || !routerIp || !routerUser || !routerPass) {
      setError("All fields are required");
      return;
    }

    try {
      await createLocation.mutateAsync({
        name,
        routerIp,
        routerUser,
        routerPass,
        connectionMethod: "direct",
        active: true,
      });

      toast.add({
        title: "Location created",
        description:
          "Router connection verified and location saved successfully.",
        type: "success",
      });

      onSuccess();
      onOpenChange(false);
      resetForm();
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to create location";
      setError(errorMessage);

      toast.add({
        title: "Failed to create location",
        description: errorMessage,
        type: "error",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) resetForm(); }}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add New Location</DialogTitle>
          <DialogDescription>
            Add a new hotspot location with MikroTik router.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="wireguard" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="wireguard">Connect via WireGuard</TabsTrigger>
            <TabsTrigger value="direct">Direct IP Connection</TabsTrigger>
          </TabsList>

          <TabsContent value="wireguard" className="space-y-4 mt-4">
            {wgPhase === "get-key" && (
              <>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Step 1: Get Your Router's Public Key</Label>
                    <p className="text-sm text-muted-foreground">
                      Run this command on your MikroTik terminal:
                    </p>
                    <div className="relative">
                      <pre className="bg-muted p-3 rounded-md text-sm font-mono overflow-x-auto">
                        /interface/wireguard/print
                      </pre>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="absolute top-2 right-2"
                        onClick={() =>
                          copyToClipboard("/interface/wireguard/print", -1)
                        }
                      >
                        {copiedIndex === -1 ? (
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="wg-public-key">
                      Router WireGuard Public Key
                    </Label>
                    <Input
                      id="wg-public-key"
                      placeholder="Paste your router's public key here"
                      value={wgPublicKey}
                      onChange={(e) => setWgPublicKey(e.target.value)}
                      disabled={provisioning}
                    />
                    <p className="text-xs text-muted-foreground">
                      Copy the 'public-key' value from the command output above
                    </p>
                  </div>

                  {error && (
                    <Alert variant="destructive">
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}
                </div>

                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => onOpenChange(false)}
                    disabled={provisioning}
                  >
                    Cancel
                  </Button>
                  <Button onClick={handleProvision} disabled={provisioning}>
                    {provisioning ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Provisioning...
                      </>
                    ) : (
                      "Generate Setup Commands"
                    )}
                  </Button>
                </DialogFooter>
              </>
            )}

            {wgPhase === "run-commands" && (
              <>
                <div className="space-y-4">
                  <Alert>
                    <CheckCircle className="h-4 w-4" />
                    <AlertDescription>
                      Your tunnel IP has been assigned: <strong>{wgAssignedIp}</strong>
                    </AlertDescription>
                  </Alert>

                  {wgNote && (
                    <Alert>
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>{wgNote}</AlertDescription>
                    </Alert>
                  )}

                  <div className="space-y-3">
                    <Label>Step 2: Run These Commands on Your Router</Label>
                    {wgCommands.map((command, index) => (
                      <div key={index} className="relative">
                        <pre className="bg-muted p-3 rounded-md text-xs font-mono overflow-x-auto pr-12">
                          {command}
                        </pre>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="absolute top-2 right-2"
                          onClick={() => copyToClipboard(command, index)}
                        >
                          {copiedIndex === index ? (
                            <CheckCircle className="h-4 w-4 text-green-600" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="wg-name">Location Name</Label>
                    <Input
                      id="wg-name"
                      placeholder="e.g., Downtown Cafe"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="wg-user">Router Username</Label>
                    <Input
                      id="wg-user"
                      placeholder="admin"
                      value={routerUser}
                      onChange={(e) => setRouterUser(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="wg-pass">Router Password</Label>
                    <Input
                      id="wg-pass"
                      type="password"
                      placeholder="••••••••"
                      value={routerPass}
                      onChange={(e) => setRouterPass(e.target.value)}
                    />
                  </div>

                  {error && (
                    <Alert variant="destructive">
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}
                </div>

                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setWgPhase("get-key")}
                  >
                    Go Back
                  </Button>
                  <Button onClick={handleVerifyConnection}>
                    I've Run the Commands
                  </Button>
                </DialogFooter>
              </>
            )}

            {wgPhase === "verify" && (
              <div className="py-8">
                <div className="flex flex-col items-center gap-4">
                  <Loader2 className="h-12 w-12 animate-spin text-primary" />
                  <div className="text-center">
                    <p className="font-medium">Connecting to your router...</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Checking tunnel connectivity...
                    </p>
                  </div>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="direct" className="space-y-4 mt-4">
            <form onSubmit={handleDirectSubmit}>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Location Name</Label>
                  <Input
                    id="name"
                    placeholder="e.g., Downtown Cafe"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={createLocation.isPending}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="routerIp">Router IP Address</Label>
                  <Input
                    id="routerIp"
                    placeholder="192.168.1.1"
                    value={routerIp}
                    onChange={(e) => setRouterIp(e.target.value)}
                    disabled={createLocation.isPending}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="routerUser">Router Username</Label>
                  <Input
                    id="routerUser"
                    placeholder="admin"
                    value={routerUser}
                    onChange={(e) => setRouterUser(e.target.value)}
                    disabled={createLocation.isPending}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="routerPass">Router Password</Label>
                  <Input
                    id="routerPass"
                    type="password"
                    placeholder="••••••••"
                    value={routerPass}
                    onChange={(e) => setRouterPass(e.target.value)}
                    disabled={createLocation.isPending}
                  />
                </div>

                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
              </div>

              <DialogFooter className="mt-6">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={createLocation.isPending}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={createLocation.isPending}>
                  {createLocation.isPending
                    ? "Verifying & Saving..."
                    : "Save Location"}
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
