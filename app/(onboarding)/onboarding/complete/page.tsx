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
  const { tenant } = useAuthStore();
  const reset = useOnboardingStore((state) => state.reset);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const refreshToken = async () => {
      const { auth } = await import("@/lib/firebase");
      if (auth.currentUser) {
        await auth.currentUser.getIdToken(true);
      }
    };
    refreshToken();
    
    // Clear onboarding state after completion
    reset();
  }, [reset]);

  const portalUrl = tenant
    ? `${process.env.NEXT_PUBLIC_APP_URL || "myapp.com"}/${tenant.slug}`
    : "";

  const handleCopy = () => {
    navigator.clipboard.writeText(portalUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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
        <div className="p-4 bg-muted rounded-lg">
          <div className="text-sm text-muted-foreground mb-1">Your Portal URL</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-sm font-mono">{portalUrl}</code>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleCopy}
            >
              {copied ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

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
          onClick={() => router.push(`/${tenant?.slug}/admin`)}
          className="w-full"
          size="lg"
        >
          Go to Dashboard
        </Button>
      </CardContent>
    </Card>
  );
}
