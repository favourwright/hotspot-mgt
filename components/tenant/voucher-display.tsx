"use client";

import { useEffect, useState } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { useRouter } from "next/navigation";
import { TenantNav } from "@/components/tenant/tenant-nav";
import { AppShell } from "@/components/system/app-shell";
import { PageContent } from "@/components/system/page-content";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/shared/copy-button";
import { LoadingSpinner } from "@/components/shared/loading-spinner";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Voucher } from "@/types/schemas";

interface TenantVoucherDisplayProps {
  tenantId: string;
  tenantSlug: string;
  businessName: string;
  voucherId: string;
}

export function TenantVoucherDisplay({
  tenantId,
  tenantSlug,
  businessName,
  voucherId,
}: TenantVoucherDisplayProps) {
  const { user } = useAuthStore();
  const router = useRouter();
  const [voucher, setVoucher] = useState<Voucher | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      router.replace(`/auth?redirect=/${tenantSlug}/voucher?id=${voucherId}`);
      return;
    }

    if (!db) {
      setLoading(false);
      return;
    }

    const voucherRef = doc(db, `tenants/${tenantId}/vouchers`, voucherId);
    const unsubscribe = onSnapshot(voucherRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = { id: snapshot.id, ...snapshot.data() } as Voucher;
        
        // Verify the voucher belongs to this user
        if (data.userId !== user.uid) {
          router.replace(`/${tenantSlug}`);
          return;
        }
        
        setVoucher(data);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user, tenantId, tenantSlug, voucherId, router]);

  if (loading) {
    return (
      <AppShell>
        <TenantNav businessName={businessName} slug={tenantSlug} />
        <div className="flex-1 flex items-center justify-center">
          <LoadingSpinner />
        </div>
      </AppShell>
    );
  }

  if (!voucher) {
    return (
      <AppShell>
        <TenantNav businessName={businessName} slug={tenantSlug} />
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center">
            <h1 className="text-2xl font-bold mb-2">Voucher Not Found</h1>
            <Button onClick={() => router.push(`/${tenantSlug}`)}>
              Go Home
            </Button>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <TenantNav businessName={businessName} slug={tenantSlug} />
      
      <PageContent>
        <div className="max-w-2xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle className="text-center text-2xl">
                Your Internet Voucher
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {voucher.status === "active" && (
                <>
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">
                        Username
                      </p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 p-3 bg-muted rounded-md font-mono text-lg">
                          {voucher.username}
                        </code>
                        <CopyButton value={voucher.username} />
                      </div>
                    </div>

                    <div>
                      <p className="text-sm text-muted-foreground mb-1">
                        Password
                      </p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 p-3 bg-muted rounded-md font-mono text-lg">
                          {voucher.password}
                        </code>
                        <CopyButton value={voucher.password} />
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t space-y-2 text-sm text-muted-foreground">
                    <p>
                      <strong>Plan:</strong> {voucher.planName}
                    </p>
                    <p>
                      <strong>Created:</strong>{" "}
                      {new Date(voucher.createdAt).toLocaleString()}
                    </p>
                  </div>

                  <div className="space-y-2 pt-4">
                    <Button
                      className="w-full"
                      onClick={() => router.push(`/${tenantSlug}/my-vouchers`)}
                    >
                      View All Vouchers
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => router.push(`/${tenantSlug}`)}
                    >
                      Buy Another Plan
                    </Button>
                  </div>
                </>
              )}

              {voucher.status === "failed" && (
                <div className="text-center py-8">
                  <p className="text-destructive mb-4">
                    Voucher generation failed. Please contact support.
                  </p>
                  <Button onClick={() => router.push(`/${tenantSlug}`)}>
                    Go Home
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </PageContent>
    </AppShell>
  );
}
