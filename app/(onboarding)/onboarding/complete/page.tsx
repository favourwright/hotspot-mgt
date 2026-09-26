"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { Check, Copy } from "lucide-react";
import { useAuthStore } from "@/stores/auth-store";
import { useOnboardingStore } from "@/stores/onboarding-store";

export default function OnboardingCompletePage() {
  const router = useRouter();
  const { tenant, userRole, loading } = useAuthStore();
  const reset = useOnboardingStore((state) => state.reset);
  const onboardingSlug = useOnboardingStore((state) => state.slug);
  const [copied, setCopied] = useState(false);
  const [pollCount, setPollCount] = useState(0);

  const tenantLoading = userRole === "owner" && !tenant && !loading;

  useEffect(() => {
    const refreshToken = async () => {
      const { auth } = await import("@/lib/firebase");
      if (auth && auth.currentUser) {
        await auth.currentUser.getIdToken(true);
      }
    };
    refreshToken();
  }, []);

  useEffect(() => {
    if (tenant) return; // Already loaded, stop polling
    if (pollCount >= 10) return; // Give up after 10s

    const timer = setTimeout(() => {
      // Force auth state re-evaluation by refreshing token
      const refresh = async () => {
        const { auth } = await import("@/lib/firebase");
        if (auth && auth.currentUser) {
          await auth.currentUser.getIdToken(true);
        }
      };
      refresh();
      setPollCount((prev) => prev + 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [tenant, pollCount]);

  const slug = tenant?.slug || onboardingSlug || "";
  const portalUrl = slug
    ? `${process.env.NEXT_PUBLIC_APP_URL || "myapp.com"}/${slug}`
    : "";

  const handleCopy = () => {
    navigator.clipboard.writeText(portalUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleGoToDashboard = () => {
    if (slug) {
      reset(); // Clear onboarding store only when navigating away
      router.push(`/${slug}/admin`);
    }
  };

  if (loading || tenantLoading) {
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
    <Card>
      <CardHeader className="text-center pb-4">
        <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
          <Check className="w-8 h-8 text-green-600" />
        </div>
        <h1 className="text-2xl font-bold">
          Welcome to {tenant?.businessName || "Your Business"}!
        </h1>
        <p className="text-muted-foreground">
          Your hotspot management portal is ready
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {slug && (
          <div className="p-4 bg-muted rounded-lg">
            <div className="text-sm text-muted-foreground mb-1">
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
      </CardContent>
    </Card>
  );
}
