"use client";

import { Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/system/dialog";

interface PortalProgressDialogProps {
  action: "install" | "uninstall" | null;
}

/**
 * Blocks the screen while the captive portal is being written to a router.
 *
 * The action lives in a dropdown, which closes on click -- so the busy state
 * on the menu item itself was never visible, and the only feedback for what
 * is often half a minute of work was nothing at all.
 *
 * The steps are listed rather than ticked off: the whole thing is a single
 * request, so there is no honest per-step progress to report. Naming them
 * still tells someone watching what is taking the time, and that it is the
 * router being slow rather than the page being stuck.
 */
export function PortalProgressDialog({ action }: PortalProgressDialogProps) {
  const installing = action === "install";

  return (
    // Not dismissible: the request is already in flight on the router, and
    // closing this would suggest it had been cancelled. `open` is fully
    // controlled with no onOpenChange, so Escape can't close it either.
    <Dialog open={action !== null} disablePointerDismissal>
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>
            {installing ? "Installing captive portal" : "Removing captive portal"}
          </DialogTitle>
          <DialogDescription>
            Talking to the router over the tunnel. This can take up to a
            minute — leave this page open.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-3 rounded-panel bg-sunken p-4">
          <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" />
          <ul className="space-y-1 text-sm text-muted-foreground">
            {installing ? (
              <>
                <li>Allowing the portal through the walled garden</li>
                <li>Writing the sign-in page to the router</li>
                <li>Pointing the hotspot at it</li>
              </>
            ) : (
              <>
                <li>Restoring the router&apos;s previous sign-in pages</li>
                <li>Removing the walled-garden entries we added</li>
              </>
            )}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
