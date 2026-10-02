"use client";

import { useEffect, useState } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { useRouter } from "next/navigation";
import { TenantNav } from "@/components/tenant/tenant-nav";
import { AppShell } from "@/components/system/app-shell";
import { PageContent } from "@/components/system/page-content";
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingSpinner } from "@/components/shared/loading-spinner";
import { collection, query, where, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Voucher } from "@/types/schemas";

interface TenantVouchersClientProps {
  tenantId: string;
  tenantSlug: string;
  businessName: string;
}

export function TenantVouchersClient({
  tenantId,
  tenantSlug,
  businessName,
}: TenantVouchersClientProps) {
  const { user } = useAuthStore();
  const router = useRouter();
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      router.replace(`/auth?redirect=/${tenantSlug}/my-vouchers`);
      return;
    }

    if (!db) {
      setLoading(false);
      return;
    }

    const vouchersRef = collection(db, `tenants/${tenantId}/vouchers`);
    const q = query(
      vouchersRef,
      where("userId", "==", user.uid),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as Voucher[];
      setVouchers(data);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user, tenantId, tenantSlug, router]);

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

  return (
    <AppShell>
      <TenantNav businessName={businessName} slug={tenantSlug} />
      
      <PageContent>
        <div className="w-full flex-1">
          <h1 className="text-3xl font-bold mb-8">My Vouchers</h1>

          {vouchers.length === 0 ? (
            <EmptyState
              title="No Vouchers Yet"
              description="You haven't purchased any vouchers yet. Browse available plans to get started."
              action={{
                label: "Browse Plans",
                onClick: () => router.push(`/${tenantSlug}`)
              }}
            />
          ) : (
            <div className="space-y-4">
              {vouchers.map((voucher) => (
                <SurfaceCard key={voucher.id}>
                  <SurfaceCardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <SurfaceCardTitle>{voucher.planName}</SurfaceCardTitle>
                        <SurfaceCardDescription>
                          {new Date(voucher.createdAt).toLocaleDateString()}
                        </SurfaceCardDescription>
                      </div>
                      <Badge
                        variant={
                          voucher.status === "active"
                            ? "default"
                            : voucher.status === "expired"
                            ? "secondary"
                            : "destructive"
                        }
                      >
                        {voucher.status}
                      </Badge>
                    </div>
                  </SurfaceCardHeader>
                  <SurfaceCardContent>
                    {voucher.status === "active" && (
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <p className="text-muted-foreground">Username</p>
                            <p className="font-mono font-semibold">
                              {voucher.username}
                            </p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Password</p>
                            <p className="font-mono font-semibold">
                              {voucher.password}
                            </p>
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          className="w-full mt-4"
                          onClick={() =>
                            router.push(`/${tenantSlug}/voucher?id=${voucher.id}`)
                          }
                        >
                          View Details
                        </Button>
                      </div>
                    )}
                    {voucher.status === "failed" && (
                      <p className="text-sm text-muted-foreground">
                        Voucher generation failed. Please contact support.
                      </p>
                    )}
                  </SurfaceCardContent>
                </SurfaceCard>
              ))}
            </div>
          )}
        </div>
      </PageContent>
    </AppShell>
  );
}
