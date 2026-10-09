"use client";

import { useState, useEffect, FormEvent } from "react";
import { useCreateRouter } from "@/hooks/use-routers";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/system/dialog";
import { StepIndicator } from "@/components/system/step-indicator";
import { useErrorState } from "@/components/system/use-error-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toast";
import { Copy, CircleCheck, Info, Loader2, AlertTriangle, ArrowLeft } from "lucide-react";
import { auth } from "@/lib/firebase";
import { copyTextToClipboard } from "@/lib/clipboard";
import { Router } from "@/types/schemas";
import { EditRouterForm } from "@/components/admin/router-dialog/edit-router-form";
import {
  WG_STEPS,
  WG_TOTAL_STEPS,
  buildReadinessCheckScript,
  generateWireGuardIdentity,
  type ConnectionMode,
  type WgPhase,
} from "@/components/admin/router-dialog/wireguard";

interface RouterDialogProps {
  mode: "create" | "edit";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  router?: Router | null;
}

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
  // Every `setError` below also raises a toast. The inline alert sits at
  // the top of a scrollable dialog, so a failed provision or verify call
  // was effectively silent once the user had scrolled to the button.
  const [error, setError] = useErrorState("Router setup failed");

  // Which connection path is shown - WireGuard is the default, guided path;
  // Direct IP is an out-of-the-way advanced option (see router-dialog rework).
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>("wireguard");

  // Direct IP fields
  const [routerIp, setRouterIp] = useState("");

  // WireGuard fields
  const [wgPhase, setWgPhase] = useState<WgPhase>("details");
  const [wgInterfaceName, setWgInterfaceName] = useState("");
  const [wgListenPort, setWgListenPort] = useState(0);
  const [wgPublicKey, setWgPublicKey] = useState("");
  const [wgAssignedIp, setWgAssignedIp] = useState("");
  const [wgCommands, setWgCommands] = useState<string[]>([]);
  const [provisioning, setProvisioning] = useState(false);
  const [polling, setPolling] = useState(false);
  const [testingCredentials, setTestingCredentials] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [configComplete, setConfigComplete] = useState(false);
  // Set only when verification times out, so we can show a targeted
  // diagnostic instead of a one-size-fits-all error message.
  const [verifyFailureKind, setVerifyFailureKind] = useState<
    "no-handshake" | "handshake-no-ping" | null
  >(null);

  const createRouter = useCreateRouter();

  // Start every registration from a clean slate -- a half-finished
  // WireGuard attempt must not leak into the next one.
  useEffect(() => {
    if (!open) resetForm();
  }, [open]);

  const resetForm = () => {
    setName("");
    setRouterIp("");
    setRouterUser("");
    setRouterPass("");
    setActive(true);
    setError("");
    setConnectionMode("wireguard");
    setWgPhase("details");
    regenerateWgIdentity();
    setWgPublicKey("");
    setWgAssignedIp("");
    setWgCommands([]);
    setConfigComplete(false);
    setTestingCredentials(false);
    setVerifyFailureKind(null);
  };

  const regenerateWgIdentity = () => {
    const { interfaceName, listenPort } = generateWireGuardIdentity();
    setWgInterfaceName(interfaceName);
    setWgListenPort(listenPort);
  };

  const copyToClipboard = async (text: string, index: number) => {
    const ok = await copyTextToClipboard(text);
    if (ok) {
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
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
          interfaceName: wgInterfaceName,
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
  ): Promise<{ reachable: boolean; handshakeEverOccurred: boolean }> => {
    // Tracked across attempts, not just the last one - a handshake that
    // happened once and then went stale still proves the tunnel itself
    // formed, which is the useful distinction for the error message below.
    let handshakeEverOccurred = false;

    for (let i = 0; i < maxAttempts; i++) {
      try {
        if (!auth || !auth.currentUser) {
          return { reachable: false, handshakeEverOccurred };
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

        if (data.success && data.data?.handshakeEverOccurred) {
          handshakeEverOccurred = true;
        }

        if (data.success && data.data?.reachable) {
          return { reachable: true, handshakeEverOccurred: true };
        }

        await new Promise((resolve) => setTimeout(resolve, 3000));
      } catch (error) {
        console.error("Poll error:", error);
      }
    }
    return { reachable: false, handshakeEverOccurred };
  };

  const handleVerifyConnection = async () => {
    if (!name || !routerUser || !routerPass) {
      setError("Please fill in all fields");
      return;
    }

    setPolling(true);
    setError("");
    setVerifyFailureKind(null);
    setWgPhase("verify");

    try {
      const { reachable, handshakeEverOccurred } = await pollConnection(wgAssignedIp);

      if (!reachable) {
        if (handshakeEverOccurred) {
          setVerifyFailureKind("handshake-no-ping");
          setError(
            "Your router connected to our server, but isn't responding back on the tunnel. This almost always means the IP-address or firewall command (commands 1 and 3 below) wasn't applied - double-check both, then try again.",
            "Tunnel reached our server but isn't responding back"
          );
        } else {
          setVerifyFailureKind("no-handshake");
          setError(
            "Your router hasn't reached our server at all yet. Double-check the public key you pasted matches what your router showed, and that your router's connection allows outbound traffic on UDP port 51820 (some networks block this).",
            "Your router hasn't reached our server yet"
          );
        }
        setWgPhase("finish");
        return;
      }

      // Tunnel confirmed - now testing credentials
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
          `Router is reachable but credentials are incorrect: ${testData.error}. Please check your MikroTik username and password.`,
          "Router reachable, but the credentials were rejected"
        );
        setWgPhase("finish");
        setTestingCredentials(false);
        return;
      }

      // Both tunnel and credentials verified - save router
      await createRouter.mutateAsync({
        name,
        connectionMethod: "wireguard",
        routerIp: wgAssignedIp,
        routerUser,
        routerPass,
        wireguardPublicKey: wgPublicKey,
        wireguardTunnelIp: wgAssignedIp,
        wireguardInterfaceName: wgInterfaceName,
        wireguardListenPort: wgListenPort,
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

    if (!routerPass) {
      setError("Password is required");
      return;
    }

    try {
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

      onSuccess();
      onOpenChange(false);
      resetForm();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to register router"
      );
    }
  };

  const isPending = createRouter.isPending;

  // Editing shares none of the registration flow's state -- its own
  // component owns it, so nothing below needs a `mode === "edit"` branch.
  if (mode === "edit") {
    return (
      <EditRouterForm
        open={open}
        onOpenChange={onOpenChange}
        onSuccess={onSuccess}
        router={router ?? null}
      />
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
              ? "Connect your MikroTik router - most routers just need a couple of commands pasted into their terminal. Takes about 5 minutes."
              : "Advanced: register a router that's already reachable at a fixed IP address."}
          </DialogDescription>
          {connectionMode === "wireguard" && (
            <>
              <p className="text-xs font-medium text-muted-foreground">
                Step {WG_STEPS[wgPhase].step} of {WG_TOTAL_STEPS} -{" "}
                {WG_STEPS[wgPhase].label}
              </p>
              <StepIndicator
                current={WG_STEPS[wgPhase].step}
                total={WG_TOTAL_STEPS}
              />
            </>
          )}
        </DialogHeader>

        {connectionMode === "wireguard" ? (
          <div className="space-y-4 min-w-0">
            {wgPhase === "details" && (
              <>
                <div className="-mx-6 max-h-[60vh] overflow-y-auto px-6 no-scrollbar space-y-4">
                  <p className="text-sm text-muted-foreground">
                    We&apos;ll use these to connect to your router once it&apos;s linked up - your
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
                      placeholder="Password"
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
                    between it and our platform - this is a one-time setup per router.
                  </p>

                  <p className="text-sm text-muted-foreground">
                    Open{" "}
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <span
                            aria-label="What is Winbox?"
                            className="inline-flex items-center gap-1 align-baseline font-medium text-foreground"
                          />
                        }
                      >
                        Winbox
                        <Info className="size-3.5" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        MikroTik&apos;s free tool for configuring routers. You
                        install it on your own computer, not the router. If
                        someone else set your router up they likely already
                        have it; otherwise it&apos;s a free download from
                        MikroTik&apos;s website.
                      </TooltipContent>
                    </Tooltip>{" "}
                    on your computer, connect to your router, and click{" "}
                    <strong>New Terminal</strong>. We&apos;ll walk you through three short commands.
                  </p>

                  <div className="space-y-2">
                    <Label>1. Check that it&apos;s safe to continue</Label>
                    <p className="text-sm text-muted-foreground">
                      This checks your router for anything that could cause a problem, before we
                      change anything. Run it and read the result before moving on.
                    </p>
                    <div className="relative">
                      <pre className="bg-muted p-3 rounded-md text-sm font-mono overflow-x-auto whitespace-pre-wrap break-all">
                        {buildReadinessCheckScript(wgInterfaceName, wgListenPort)}
                      </pre>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="absolute top-2 right-2"
                        onClick={() =>
                          copyToClipboard(
                            buildReadinessCheckScript(wgInterfaceName, wgListenPort),
                            -1
                          )
                        }
                      >
                        {copiedIndex === -1 ? (
                          <CircleCheck className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      If it prints <strong>READY</strong>, continue to the next command below. If
                      it prints <strong>NOT READY</strong>,{" "}
                      <button
                        type="button"
                        onClick={regenerateWgIdentity}
                        className="underline hover:text-foreground"
                      >
                        generate a new connection name and try again
                      </button>{" "}
                      - if it still says NOT READY after that, stop here and contact support with
                      the message shown.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>2. Create the connection on your router</Label>
                    <div className="relative">
                      <pre className="bg-muted p-3 rounded-md text-sm font-mono overflow-x-auto whitespace-pre-wrap break-all">
                        {`/interface/wireguard add name=${wgInterfaceName} listen-port=${wgListenPort}`}
                      </pre>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="absolute top-2 right-2"
                        onClick={() =>
                          copyToClipboard(
                            `/interface/wireguard add name=${wgInterfaceName} listen-port=${wgListenPort}`,
                            -2
                          )
                        }
                      >
                        {copiedIndex === -2 ? (
                          <CircleCheck className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>3. Show its public key</Label>
                    <p className="text-sm text-muted-foreground">
                      This prints a `public-key` value you&apos;ll copy into the field below.
                    </p>
                    <div className="relative">
                      <pre className="bg-muted p-3 rounded-md text-sm font-mono overflow-x-auto whitespace-pre-wrap break-all">
                        /interface/wireguard/print
                      </pre>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="absolute top-2 right-2"
                        onClick={() =>
                          copyToClipboard("/interface/wireguard/print", -3)
                        }
                      >
                        {copiedIndex === -3 ? (
                          <CircleCheck className="h-4 w-4 text-emerald-600" />
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
                      Copy the value next to &apos;public-key&apos; from the command output above -
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

                <DialogFooter>
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
                    <CircleCheck className="h-4 w-4" />
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
                        <pre className="bg-muted p-3 rounded-md text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all pr-12">
                          {command}
                        </pre>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="absolute top-2 right-2"
                          onClick={() => copyToClipboard(command, index)}
                        >
                          {copiedIndex === index ? (
                            <CircleCheck className="h-4 w-4 text-emerald-600" />
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

                  {verifyFailureKind && (
                    <div className="space-y-2">
                      <Label>Check what&apos;s happening on your router</Label>
                      <p className="text-sm text-muted-foreground">
                        This is safe to run any time - it only reads information, it doesn&apos;t
                        change anything:
                      </p>
                      <div className="relative">
                        <pre className="bg-muted p-3 rounded-md text-sm font-mono overflow-x-auto whitespace-pre-wrap break-all pr-12">
                          /interface/wireguard/peers print
                        </pre>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="absolute top-2 right-2"
                          onClick={() => copyToClipboard("/interface/wireguard/peers print", -4)}
                        >
                          {copiedIndex === -4 ? (
                            <CircleCheck className="h-4 w-4 text-emerald-600" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {verifyFailureKind === "no-handshake"
                          ? "Look at last-handshake - if it says \"never\", your router hasn't reached our server at all. Re-check the public key and that command 2 (adding the peer) ran without an error."
                          : "Look at last-handshake - if it shows a recent time, the tunnel is encrypted and working; the problem is specifically commands 1 (IP address) or 3 (firewall) below not being applied."}
                      </p>
                    </div>
                  )}
                </div>

                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setError("");
                      setVerifyFailureKind(null);
                      setWgPhase("connect");
                    }}
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
                  {/* Step 1 - Tunnel connectivity */}
                  <div className="flex items-center gap-3 w-full max-w-xs">
                    {!testingCredentials ? (
                      <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
                    ) : (
                      <CircleCheck className="h-5 w-5 text-emerald-600 shrink-0" />
                    )}
                    <div>
                      <p className="text-sm font-medium">Checking tunnel connectivity</p>
                      <p className="text-xs text-muted-foreground">Pinging {wgAssignedIp}...</p>
                    </div>
                  </div>

                  {/* Step 2 - Credential verification */}
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
          <div className="space-y-4 mt-4 min-w-0">
            <p className="text-xs text-muted-foreground">
              <button
                type="button"
                onClick={() => {
                  setConnectionMode("wireguard");
                  setWgPhase("details");
                  setError("");
                }}
                className="inline-flex items-center gap-1 underline hover:text-foreground"
              >
                <ArrowLeft className="size-3.5" />
                Use WireGuard instead
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
                    placeholder="Password"
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
