"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { useAuth } from "@/providers/auth-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Copy, CheckCircle } from "lucide-react";

interface Voucher {
  id: string;
  username: string;
  password: string;
  planName: string;
  locationName: string;
  duration: string;
  dataLimit?: string;
  status: "active" | "failed" | "expired";
  failureReason?: string;
}

function VoucherContent() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const voucherId = searchParams.get("id");

  const [voucher, setVoucher] = useState<Voucher | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/auth?redirect=/voucher");
      return;
    }

    if (!user || !voucherId) {
      if (!voucherId) {
        router.push("/");
      }
      return;
    }

    async function fetchVoucher() {
      if (!db) return; // Guard against undefined db
      
      try {
        const voucherDoc = await getDoc(doc(db, COLLECTIONS.VOUCHERS, voucherId!));
        
        if (!voucherDoc.exists()) {
          setError("Voucher not found");
          return;
        }

        const voucherData = voucherDoc.data();

        // Verify ownership
        if (voucherData.userId !== user?.uid) {
          setError("Unauthorized access to this voucher");
          return;
        }

        setVoucher({
          id: voucherDoc.id,
          ...voucherData,
        } as Voucher);
      } catch (error) {
        console.error("Error fetching voucher:", error);
        setError("Failed to load voucher");
      } finally {
        setLoading(false);
      }
    }

    fetchVoucher();

    // Auto-refresh for failed vouchers
    if (voucher?.status === "failed") {
      const interval = setInterval(fetchVoucher, 30000); // 30 seconds
      return () => clearInterval(interval);
    }
  }, [user, authLoading, router, voucherId, voucher?.status]);

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="container mx-auto py-8">
        <div className="text-center">Loading voucher...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto py-8 max-w-2xl">
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <div className="mt-4">
          <Button onClick={() => router.push("/")}>Go Home</Button>
        </div>
      </div>
    );
  }

  if (!voucher) {
    return null;
  }

  if (voucher.status === "failed") {
    return (
      <div className="container mx-auto py-8 max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Badge variant="secondary">Processing</Badge>
              Payment Received
            </CardTitle>
            <CardDescription>
              Your voucher is being generated. This page will update automatically.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            </div>
            <Alert>
              <AlertDescription>
                <p className="font-medium mb-2">What&apos;s happening?</p>
                <p className="text-sm">
                  We received your payment successfully. We&apos;re currently generating your
                  hotspot credentials on our system. This usually takes a few moments.
                </p>
                <p className="text-sm mt-2">
                  If this takes longer than expected, please contact support with your
                  reference: <span className="font-mono">{voucher.id}</span>
                </p>
              </AlertDescription>
            </Alert>
            {voucher.failureReason && (
              <Alert variant="destructive">
                <AlertDescription>
                  <p className="text-sm">Technical details: {voucher.failureReason}</p>
                </AlertDescription>
              </Alert>
            )}
            <div className="space-y-2 pt-4">
              <h3 className="font-semibold">Order Details</h3>
              <div className="text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Plan:</span>
                  <span>{voucher.planName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Location:</span>
                  <span>{voucher.locationName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Duration:</span>
                  <span>{voucher.duration}</span>
                </div>
              </div>
            </div>
            <Button onClick={() => router.push("/my-vouchers")} className="w-full">
              View My Vouchers
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 max-w-2xl">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-6 w-6 text-green-600" />
              Voucher Generated
            </CardTitle>
            <Badge variant={voucher.status === "active" ? "default" : "secondary"}>
              {voucher.status}
            </Badge>
          </div>
          <CardDescription>
            Your internet access credentials are ready. Save these details.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert>
            <AlertDescription>
              Use these credentials to connect to the hotspot network at {voucher.locationName}
            </AlertDescription>
          </Alert>

          <div className="space-y-4">
            <div className="bg-muted p-4 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">Username</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(voucher.username, "username")}
                >
                  {copiedField === "username" ? (
                    <CheckCircle className="h-4 w-4 text-green-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-2xl font-bold font-mono break-all">{voucher.username}</p>
            </div>

            <div className="bg-muted p-4 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">Password</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(voucher.password, "password")}
                >
                  {copiedField === "password" ? (
                    <CheckCircle className="h-4 w-4 text-green-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-2xl font-bold font-mono break-all">{voucher.password}</p>
            </div>
          </div>

          <div className="border-t pt-4 space-y-2">
            <h3 className="font-semibold">Plan Details</h3>
            <div className="text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Plan:</span>
                <span>{voucher.planName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Location:</span>
                <span>{voucher.locationName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Duration:</span>
                <span>{voucher.duration}</span>
              </div>
              {voucher.dataLimit && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Data Limit:</span>
                  <span>{voucher.dataLimit}</span>
                </div>
              )}
            </div>
          </div>

          <Alert>
            <AlertDescription className="text-sm">
              <p className="font-medium mb-1">📱 Saved to Your Account</p>
              <p>
                You can view this voucher anytime from your account. Visit the My Vouchers page
                to see all your purchase history.
              </p>
            </AlertDescription>
          </Alert>

          <div className="flex gap-2">
            <Button onClick={() => router.push("/my-vouchers")} className="flex-1">
              My Vouchers
            </Button>
            <Button onClick={() => router.push("/")} variant="outline" className="flex-1">
              Buy More
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function VoucherPage() {
  return (
    <Suspense fallback={
      <div className="container mx-auto py-8">
        <div className="text-center">Loading...</div>
      </div>
    }>
      <VoucherContent />
    </Suspense>
  );
}
