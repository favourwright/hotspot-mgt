"use client";

import { useState, useEffect, FormEvent } from "react";
import { useCreateRouter, useUpdateRouter } from "@/hooks/use-routers";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { Copy, CheckCircle, Loader2, AlertTriangle } from "lucide-react";
import { auth } from "@/lib/firebase";
import { Router } from "@/types/schemas";

interface RouterDialogProps {
  mode: "create" | "edit";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  router?: Router | null;
}

type ConnectionMode = "wireguard" | "direct";
type WgPhase = "details" | "connect" | "finish" | "verify";

const WG_STEP_LABELS: Record<WgPhase, string> = {
  details: "Step 1 of 3 — Router Details",
  connect: "Step 2 of 3 — Connect Your Router",
  finish: "Step 3 of 3 — Finish Setup",
  verify: "Step 3 of 3 — Verifying Connection",
};

export function RouterDialog({
  mode,
  open,
  onOpenChange,
  onSuccess,
  router,
}: RouterDialogProps) {
  // Common fields
  const [name, setName] = useState("");
  const [routerUser, setRouterUser] = useState("");
  const [routerPass, setRouterPass] = useState("");
  const [active, setActive] = useState(true);
  const [error, setError] = useState("");

  // Which connection path is shown — WireGuard is the default, guided path;
  // Direct IP is an out-of-the-way advanced option (see router-dialog rework).
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>("wireguard");

  // Direct IP fields
  const [routerIp, setRouterIp] = useState("");

  // WireGuard fields
  const [wgPhase, setWgPhase] = useState<WgPhase>("details");
  const [wgPublicKey, setWgPublicKey] = useState("");
  const [wgAssignedIp, setWgAssignedIp] = useState("");
  const [wgCommands, setWgCommands] = useState<string[]>([]);
  const [provisioning, setProvisioning] = useState(false);
  const [polling, setPolling] = useState(false);
  const [testingCredentials, setTestingCredentials] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [configComplete, setConfigComplete] = useState(false);

  const createRouter = useCreateRouter();
  const updateRouter = useUpdateRouter();

  // Reset or populate form based on mode
  useEffect(() => {
    if (mode === "edit" && router) {
      setName(router.name);
      setRouterIp(router.routerIp);
      setRouterUser(router.routerUser);
      setRouterPass(""); // Don't pre-fill password
      setActive(router.active);
      setWgPublicKey(router.wireguardPublicKey || "");
      setWgAssignedIp(router.wireguardTunnelIp || "");
    } else if (mode === "create" && !open) {
      resetForm();
    }
  }, [mode, router, open]);

  const resetForm = () => {
    setName("");
    setRouterIp("");
    setRouterUser("");
    setRouterPass("");
    setActive(true);
    setError("");
    setConnectionMode("wireguard");
    setWgPhase("details");
    setWgPublicKey("");
    setWgAssignedIp("");
    setWgCommands([]);
    setConfigComplete(false);
    setTestingCredentials(false);
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

  const handleDetailsContinue = () => {
    if (!name.trim() || !routerUser.trim() || !routerPass.trim()) {
      setError("Please fill in all fields");
      return;
    }
    setError("");
    setWgPhase("connect");
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

      const response = await fetch("/api/admin/routers/provision", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          publicKey: wgPublicKey.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to provision WireGuard peer");
      }

      setWgAssignedIp(data.data.assignedIp);
      setWgCommands(data.data.commands);
      setConfigComplete(data.data.configComplete);

      if (data.data.alreadyExists) {
        toast.add({
          title: "Router already registered",
          description: "This router was previously registered. You can continue with the setup.",
          type: "info",
        });
      }

      setWgPhase("finish");
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
          `/api/admin/routers/tunnel-status/${assignedIp}`,
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
        setWgPhase("finish");
        return;
      }

      // Tunnel confirmed — now testing credentials
      setTestingCredentials(true);

      if (!auth || !auth.currentUser) {
        throw new Error("Not authenticated");
      }
      const token = await auth.currentUser.getIdToken();

      const testResponse = await fetch("/api/admin/routers/test-connection", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          routerIp: wgAssignedIp,
          routerUser,
          routerPass,
        }),
      });

      const testData = await testResponse.json();

      if (!testResponse.ok || !testData.success) {
        setError(
          `Router is reachable but credentials are incorrect: ${testData.error}. Please check your MikroTik username and password.`
        );
        setWgPhase("finish");
        setTestingCredentials(false);
        return;
      }

      // Both tunnel and credentials verified — save router
      await createRouter.mutateAsync({
        name,
        connectionMethod: "wireguard",
        routerIp: wgAssignedIp,
        routerUser,
        routerPass,
        wireguardPublicKey: wgPublicKey,
        wireguardTunnelIp: wgAssignedIp,
        status: "online",
      });

      toast.add({
        title: "Router registered",
        description: "Router connected via WireGuard and registered successfully.",
        type: "success",
      });

      onSuccess();
      onOpenChange(false);
      resetForm();
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to register router";
      setError(errorMessage);
      setWgPhase("finish");

      toast.add({
        title: "Failed to register router",
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

    if (!name || !routerIp || !routerUser) {
      setError("Name, IP, and username are required");
      return;
    }

    try {
      if (mode === "create") {
        if (!routerPass) {
          setError("Password is required");
          return;
        }

        await createRouter.mutateAsync({
          name,
          connectionMethod: "direct",
          routerIp,
          routerUser,
          routerPass,
          status: "online",
        });

        toast.add({
          title: "Router registered",
          description: "Router connection verified and registered successfully.",
          type: "success",
        });
      } else {
        if (!router) return;

        const updateData: {
          id: string;
          name: string;
          routerIp: string;
          routerUser: string;
          routerPass?: string;
          active: boolean;
        } = {
          id: router.id,
          name,
          routerIp,
          routerUser,
          active,
        };

        // Only include password if it was changed
        if (routerPass.trim()) {
          updateData.routerPass = routerPass;
        }

        await updateRouter.mutateAsync(updateData);

        toast.add({
          title: "Router updated",
          description: "Router settings updated successfully.",
          type: "success",
        });
      }

      onSuccess();
      onOpenChange(false);
      if (mode === "create") resetForm();
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : `Failed to ${mode === "create" ? "register" : "update"} router`;
      setError(errorMessage);

      toast.add({
        title: `Failed to ${mode === "create" ? "register" : "update"} router`,
        description: errorMessage,
        type: "error",
      });
    }
  };

  const isPending = createRouter.isPending || updateRouter.isPending;

  // In edit mode, show simplified form
  if (mode === "edit") {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-150">
          <DialogHeader>
            <DialogTitle>Edit Router</DialogTitle>
            <DialogDescription>
              Update router settings. Connection method and tunnel IP cannot be changed. Leave password blank to keep unchanged.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleDirectSubmit}>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-name">Router Name</Label>
                <Input
                  id="edit-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isPending}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-ip">Router IP / Tunnel IP</Label>
                <Input
                  id="edit-ip"
                  value={routerIp}
                  onChange={(e) => setRouterIp(e.target.value)}
                  disabled={isPending || router?.connectionMethod === "wireguard"}
                />
                {router?.connectionMethod === "wireguard" && (
                  <p className="text-xs text-muted-foreground">
                    Tunnel IP cannot be changed for WireGuard routers
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-user">Router Username</Label>
                <Input
                  id="edit-user"
                  value={routerUser}
                  onChange={(e) => setRouterUser(e.target.value)}
                  disabled={isPending}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-pass">Router Password</Label>
                <Input
                  id="edit-pass"
                  type="password"
                  placeholder="Leave blank to keep current password"
                  value={routerPass}
                  onChange={(e) => setRouterPass(e.target.value)}
                  disabled={isPending}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="edit-active">Active</Label>
                  <p className="text-sm text-muted-foreground">
                    Inactive routers cannot be used for new locations
                  </p>
                </div>
                <Switch
                  id="edit-active"
                  checked={active}
                  onCheckedChange={setActive}
                  disabled={isPending}
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
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    );
  }

  // Create mode
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) resetForm(); }}>
      <DialogContent className="sm:max-w-150">
        <DialogHeader>
          <DialogTitle>Register MikroTik Router</DialogTitle>
          <DialogDescription>
            {connectionMode === "wireguard"
              ? "Connect your MikroTik router — most routers just need a couple of commands pasted into their terminal. Takes about 5 minutes."
              : "Advanced: register a router that's already reachable at a fixed IP address."}
          </DialogDescription>
          {connectionMode === "wireguard" && (
            <p className="text-xs font-medium text-primary">
              {WG_STEP_LABELS[wgPhase]}
            </p>
          )}
        </DialogHeader>

        {connectionMode === "wireguard" ? (
          <div className="space-y-4 mt-4">
            {wgPhase === "details" && (
              <>
                <div className="-mx-6 max-h-[60vh] overflow-y-auto px-6 no-scrollbar space-y-4">
                  <p className="text-sm text-muted-foreground">
                    We&apos;ll use these to connect to your router once it&apos;s linked up — your
                    credentials are stored securely and are only ever used to talk to your router.
                  </p>

                  <div className="space-y-2">
                    <Label htmlFor="wg-details-name">Router Name</Label>
                    <Input
                      id="wg-details-name"
                      placeholder="e.g., Main Office Router"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="wg-details-user">Router Username</Label>
                    <Input
                      id="wg-details-user"
                      placeholder="admin"
                      value={routerUser}
                      onChange={(e) => setRouterUser(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="wg-details-pass">Router Password</Label>
                    <Input
                      id="wg-details-pass"
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

                <DialogFooter className="mt-6">
                  <Button
                    variant="outline"
                    onClick={() => onOpenChange(false)}
                  >
                    Cancel
                  </Button>
                  <Button onClick={handleDetailsContinue}>
                    Continue
                  </Button>
                </DialogFooter>

                <p className="text-center text-xs text-muted-foreground">
                  Router already reachable directly, or has a public IP?{" "}
                  <button
                    type="button"
                    onClick={() => setConnectionMode("direct")}
                    className="underline hover:text-foreground"
                  >
                    Use direct IP instead
                  </button>
                </p>
              </>
            )}

            {wgPhase === "connect" && (
              <>
                <div className="-mx-6 max-h-[60vh] overflow-y-auto px-6 no-scrollbar space-y-4">
                  <p className="text-sm text-muted-foreground">
                    To reach your router securely, we need to set up an encrypted connection
                    between it and our platform — this is a one-time setup per router.
                  </p>

                  <p className="text-sm text-muted-foreground">
                    You&apos;ll need <strong>Winbox</strong>, MikroTik&apos;s free tool for
                    configuring routers. It&apos;s a program you install on your own computer
                    (not the router) and use to connect to the router — if someone else set up
                    your router, they likely already have it; otherwise it&apos;s a free download
                    from MikroTik&apos;s website.
                  </p>

                  <p className="text-sm text-muted-foreground">
                    Open Winbox on your computer, connect to your router, click{" "}
                    <strong>New Terminal</strong>, and run these two commands:
                  </p>

                  <div className="space-y-2">
                    <Label>1. Create the connection on your router</Label>
                    <div className="relative">
                      <pre className="bg-muted p-3 rounded-md text-sm font-mono overflow-x-auto">
                        /interface/wireguard add name=wg0 listen-port=13231
                      </pre>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="absolute top-2 right-2"
                        onClick={() =>
                          copyToClipboard("/interface/wireguard add name=wg0 listen-port=13231", -1)
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
                    <Label>2. Show its public key</Label>
                    <p className="text-sm text-muted-foreground">
                      This prints a `public-key` value you&apos;ll copy into the field below.
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
                          copyToClipboard("/interface/wireguard/print", -2)
                        }
                      >
                        {copiedIndex === -2 ? (
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
                      Copy the value next to &apos;public-key&apos; from the command output above —
                      it looks like a random string of letters and numbers ending in{" "}
                      <code>=</code>.
                    </p>
                  </div>

                  {error && (
                    <Alert variant="destructive">
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}
                </div>

                <DialogFooter className="mt-6">
                  <Button
                    variant="outline"
                    onClick={() => setWgPhase("details")}
                    disabled={provisioning}
                  >
                    Go Back
                  </Button>
                  <Button onClick={handleProvision} disabled={provisioning}>
                    {provisioning ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Connecting...
                      </>
                    ) : (
                      "Get My Connection Commands"
                    )}
                  </Button>
                </DialogFooter>
              </>
            )}

            {wgPhase === "finish" && (
              <>
                <div className="-mx-6 max-h-[60vh] overflow-y-auto px-6 no-scrollbar space-y-4">
                  <Alert>
                    <CheckCircle className="h-4 w-4" />
                    <AlertDescription>
                      Your router&apos;s private connection address has been assigned:{" "}
                      <strong>{wgAssignedIp}</strong>
                    </AlertDescription>
                  </Alert>

                  {!configComplete && (
                    <Alert>
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        Some commands contain placeholders. Contact your platform admin to complete WireGuard configuration.
                      </AlertDescription>
                    </Alert>
                  )}

                  <div className="space-y-3">
                    <Label>Run these final commands on your router</Label>
                    <p className="text-sm text-muted-foreground">
                      Back in the same Winbox terminal, copy and paste each command below, one at
                      a time:
                    </p>
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

                  {error && (
                    <Alert variant="destructive">
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}
                </div>

                <DialogFooter className="mt-6">
                  <Button
                    variant="outline"
                    onClick={() => setWgPhase("connect")}
                  >
                    Go Back
                  </Button>
                  <Button onClick={handleVerifyConnection}>
                    I&apos;ve Run the Commands
                  </Button>
                </DialogFooter>
              </>
            )}

            {wgPhase === "verify" && (
              <div className="py-8">
                <div className="flex flex-col items-center gap-6">
                  {/* Step 1 — Tunnel connectivity */}
                  <div className="flex items-center gap-3 w-full max-w-xs">
                    {!testingCredentials ? (
                      <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
                    ) : (
                      <CheckCircle className="h-5 w-5 text-green-600 shrink-0" />
                    )}
                    <div>
                      <p className="text-sm font-medium">Checking tunnel connectivity</p>
                      <p className="text-xs text-muted-foreground">Pinging {wgAssignedIp}...</p>
                    </div>
                  </div>

                  {/* Step 2 — Credential verification */}
                  <div className="flex items-center gap-3 w-full max-w-xs">
                    {!testingCredentials ? (
                      <div className="h-5 w-5 rounded-full border-2 border-muted shrink-0" />
                    ) : (
                      <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
                    )}
                    <div>
                      <p className={`text-sm font-medium ${!testingCredentials ? "text-muted-foreground" : ""}`}>
                        Verifying MikroTik credentials
                      </p>
                      <p className="text-xs text-muted-foreground">Testing API access...</p>
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground text-center">
                    This may take up to 60 seconds. Don&apos;t close this window.
                  </p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4 mt-4">
            <p className="text-xs text-muted-foreground">
              <button
                type="button"
                onClick={() => {
                  setConnectionMode("wireguard");
                  setWgPhase("details");
                  setError("");
                }}
                className="underline hover:text-foreground"
              >
                &larr; Use WireGuard instead
              </button>
            </p>

            <form onSubmit={handleDirectSubmit}>
              <div className="-mx-6 max-h-[60vh] overflow-y-auto px-6 no-scrollbar space-y-4">
                <Alert>
                  <AlertDescription>
                    Only use this if your router already has a public IP address, or has already
                    been connected to our network directly. Most routers behind a home or office
                    network should use WireGuard instead. This requires your router to be
                    publicly accessible on port 443 (HTTPS) with www-ssl enabled.
                  </AlertDescription>
                </Alert>

                <div className="space-y-2">
                  <Label htmlFor="name">Router Name</Label>
                  <Input
                    id="name"
                    placeholder="e.g., Main Office Router"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={isPending}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="routerIp">Router IP Address</Label>
                  <Input
                    id="routerIp"
                    placeholder="192.168.1.1 or public IP"
                    value={routerIp}
                    onChange={(e) => setRouterIp(e.target.value)}
                    disabled={isPending}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="routerUser">Router Username</Label>
                  <Input
                    id="routerUser"
                    placeholder="admin"
                    value={routerUser}
                    onChange={(e) => setRouterUser(e.target.value)}
                    disabled={isPending}
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
                    disabled={isPending}
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
                  disabled={isPending}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isPending}>
                  {isPending ? "Verifying & Saving..." : "Register Router"}
                </Button>
              </DialogFooter>
            </form>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
