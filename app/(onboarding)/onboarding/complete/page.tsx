"use client";

import { useEffect, useState } from "react";
import { refreshSession } from "@/lib/session-client";
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardHeader,
} from "@/components/system/surface-card";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { Check, PartyPopper, Copy, Loader2 } from "lucide-react";
import { useAuthStore } from "@/stores/auth-store";
import { useOnboardingStore } from "@/stores/onboarding-store";
import { copyTextToClipboard } from "@/lib/clipboard";
import { pushTenantUrl, tenantUrl } from "@/lib/tenant-url";

export default function OnboardingCompletePage() {
  const router = useRouter();
  const { tenant, loading } = useAuthStore();
  const reset = useOnboardingStore((state) => state.reset);
  const onboardingSlug = useOnboardingStore((state) => state.slug);
  const [copied, setCopied] = useState(false);
  const [pollCount, setPollCount] = useState(0);

  // The full tenant object (business name, payment status, etc.) can take a
  // moment to load after onboarding - the portal URL/slug is shown
  // immediately below via the onboarding store fallback, so this only
  // gates the few details that genuinely need the loaded tenant. Stop
  // showing it as "loading" once the poll below gives up, so it doesn't
  // spin forever.
  const detailsLoading = !loading && !tenant && pollCount < 10;

  useEffect(() => {
    // Also re-mints the session cookie, so the role/tenant the server sees
    // matches the claims this refresh just picked up.
    refreshSession();
  }, []);

  useEffect(() => {
    if (tenant) return; // Already loaded, stop polling
    if (pollCount >= 10) return; // Give up after 10s

    const timer = setTimeout(() => {
      // Force auth state re-evaluation by refreshing token
      refreshSession();
      setPollCount((prev) => prev + 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [tenant, pollCount]);

  const slug = tenant?.slug || onboardingSlug || "";

  // Clear the wizard as soon as the tenant is actually confirmed, not when
  // someone happens to press "Go to dashboard".
  //
  // That button was the only thing calling reset(), so closing the tab,
  // hitting back, or bookmarking this page left the whole wizard behind -
  // including the bank code, account number and account name. On a shared
  // or public machine that is somebody else's banking details sitting in
  // localStorage indefinitely.
  //
  // Keyed on `tenant` rather than on arriving here, because until it loads
  // `onboardingSlug` is the only copy of the slug this page has to show.
  // Wiping the store first would blank the portal URL the page exists to
  // hand over. Once `tenant` is present it supplies the slug itself and the
  // store is pure residue.
  useEffect(() => {
    if (tenant) reset();
  }, [tenant, reset]);
  const portalUrl = slug ? tenantUrl(slug) : "";

  const handleCopy = async () => {
    const ok = await copyTextToClipboard(portalUrl);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleGoToDashboard = () => {
    if (slug) {
      // Belt and braces. The effect above has almost certainly run by now;
      // this covers the case where the tenant never loaded and the user
      // leaves anyway, which would otherwise be the one exit that still
      // left the bank details behind.
      reset();
      pushTenantUrl(router, slug, "/admin");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-gray-900" />
          <p className="text-sm text-muted-foreground">
            Setting up your portal...
          </p>
        </div>
      </div>
    );
  }

  return (
    <SurfaceCard>
      <SurfaceCardHeader className="text-center py-4">
        <div className="mx-auto size-16 bg-emerald-100 rounded-3xl flex items-center justify-center mb-4">
          <PartyPopper className="w-8 h-8 text-emerald-800" />
        </div>
        <h1 className="text-2xl font-bold">
          {detailsLoading
            ? "Welcome!"
            : `Welcome to ${tenant?.businessName || "Your Business"}!`}
        </h1>
        <p className="text-muted-foreground">
          Your hotspot management portal is ready
        </p>
        {detailsLoading ? (
          <p className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground mt-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            Finalizing your account details...
          </p>
        ) : tenant?.monthlyFee ? (
          <p className="text-sm text-muted-foreground mt-1">
            Your first month's payment was successful. Your subscription will
            renew automatically.
          </p>
        ) : null}
      </SurfaceCardHeader>
      <SurfaceCardContent className="space-y-6">
        {slug && (
          <div className="p-4 py-3 bg-muted-foreground/5 rounded-lg">
            <div className="text-sm text-muted-foreground">
              Your Portal URL
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm font-mono">{portalUrl}</code>
              <Button size="sm" variant="ghost" onClick={handleCopy}>
                {copied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        )}

        <div>
          <h3 className="font-semibold mb-3">What's next?</h3>
          <ol className="space-y-3">
            <li className="flex gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-semibold">
                1
              </div>
              <div>
                <div className="font-medium">Add your first router location</div>
                <div className="text-sm text-muted-foreground">
                  Connect your MikroTik router to start managing hotspot users
                </div>
              </div>
            </li>
            <li className="flex gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-semibold">
                2
              </div>
              <div>
                <div className="font-medium">Create your hotspot plans</div>
                <div className="text-sm text-muted-foreground">
                  Set up pricing and data limits for your customers
                </div>
              </div>
            </li>
            <li className="flex gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-semibold">
                3
              </div>
              <div>
                <div className="font-medium">Share your portal with customers</div>
                <div className="text-sm text-muted-foreground">
                  Customers can visit your portal to purchase vouchers online
                </div>
              </div>
            </li>
          </ol>
        </div>

        <Button
          onClick={handleGoToDashboard}
          className="w-full"
          size="lg"
          disabled={!slug}
        >
          Go to Dashboard
        </Button>
      </SurfaceCardContent>
    </SurfaceCard>
  );
}
