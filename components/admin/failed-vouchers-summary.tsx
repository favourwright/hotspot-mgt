"use client";

import Link from "next/link";
import { Voucher } from "@/types/schemas";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/system/button";
import {
  SurfaceCard,
  SurfaceCardAction,
  SurfaceCardContent,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card";

interface FailedVouchersSummaryProps {
  vouchers: Voucher[];
  tenantSlug: string;
}

export function FailedVouchersSummary({
  vouchers,
  tenantSlug,
}: FailedVouchersSummaryProps) {
  if (vouchers.length === 0) {
    return (
      <SurfaceCard>
        <SurfaceCardHeader>
          <SurfaceCardTitle>Failed Vouchers</SurfaceCardTitle>
        </SurfaceCardHeader>
        <SurfaceCardContent>
          <p className="text-sm text-muted-foreground">No failed vouchers.</p>
        </SurfaceCardContent>
      </SurfaceCard>
    );
  }

  return (
    <SurfaceCard>
      <SurfaceCardHeader>
        <SurfaceCardTitle>Failed Vouchers</SurfaceCardTitle>
        <SurfaceCardAction>
          <Button
            tone="sunken"
            scale="sm"
            nativeButton={false}
            render={<Link href={`/${tenantSlug}/admin/failed`} />}
          >
            View all
          </Button>
        </SurfaceCardAction>
      </SurfaceCardHeader>
      <SurfaceCardContent>
        <div className="space-y-3">
        {vouchers.map((voucher) => (
          <div
            key={voucher.id}
            className="flex items-center justify-between text-sm"
          >
            <div>
              <p className="font-medium">{voucher.userEmail}</p>
              <p className="text-muted-foreground text-xs">
                {formatDate(voucher.createdAt)}
              </p>
            </div>
            <Badge variant="destructive">Failed</Badge>
          </div>
          ))}
        </div>
      </SurfaceCardContent>
    </SurfaceCard>
  );
}
