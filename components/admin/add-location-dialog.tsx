"use client";

import { useState, FormEvent } from "react";
import { auth } from "@/lib/firebase";
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
import { Alert } from "@/components/ui/alert";

interface AddLocationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function AddLocationDialog({
  open,
  onOpenChange,
  onSuccess,
}: AddLocationDialogProps) {
  const [name, setName] = useState("");
  const [routerIp, setRouterIp] = useState("");
  const [routerUser, setRouterUser] = useState("");
  const [routerPass, setRouterPass] = useState("");
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [error, setError] = useState("");

  const handleTest = async () => {
    if (!routerIp || !routerUser || !routerPass) {
      setError("Please fill in all router credentials");
      return;
    }

    setTesting(true);
    setError("");
    setTestResult(null);

    try {
      const user = auth?.currentUser;
      if (!user) throw new Error("Not authenticated");

      const token = await user.getIdToken();

      const response = await fetch("/api/admin/locations/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ routerIp, routerUser, routerPass }),
      });

      const result = await response.json();

      if (result.success) {
        setTestResult({
          success: true,
          message: `Connected! Router version: ${result.data.version}, Uptime: ${result.data.uptime}`,
        });
      } else {
        setTestResult({
          success: false,
          message: result.error || "Connection test failed",
        });
      }
    } catch (err) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : "Connection test failed",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (!name || !routerIp || !routerUser || !routerPass) {
      setError("All fields are required");
      return;
    }

    setLoading(true);

    try {
      const user = auth?.currentUser;
      if (!user) throw new Error("Not authenticated");

      const token = await user.getIdToken();

      const response = await fetch("/api/admin/locations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name, routerIp, routerUser, routerPass }),
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || "Failed to create location");
      }

      onSuccess();
      onOpenChange(false);
      
      // Reset form
      setName("");
      setRouterIp("");
      setRouterUser("");
      setRouterPass("");
      setTestResult(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create location");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add New Location</DialogTitle>
          <DialogDescription>
            Add a new hotspot location with MikroTik router details.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Location Name</Label>
              <Input
                id="name"
                placeholder="e.g., Downtown Cafe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="routerIp">Router IP Address</Label>
              <Input
                id="routerIp"
                placeholder="192.168.1.1"
                value={routerIp}
                onChange={(e) => setRouterIp(e.target.value)}
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="routerUser">Router Username</Label>
              <Input
                id="routerUser"
                placeholder="admin"
                value={routerUser}
                onChange={(e) => setRouterUser(e.target.value)}
                disabled={loading}
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
                disabled={loading}
              />
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={handleTest}
              disabled={testing || loading}
              className="w-full"
            >
              {testing ? "Testing..." : "Test Connection"}
            </Button>

            {testResult && (
              <Alert variant={testResult.success ? "default" : "destructive"}>
                <p className="text-sm">{testResult.message}</p>
              </Alert>
            )}

            {error && (
              <Alert variant="destructive">
                <p className="text-sm">{error}</p>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || (!testResult?.success && testResult !== null)}
            >
              {loading ? "Saving..." : "Save Location"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
