"use client";

import { Voucher } from "@/types/schemas";
import { formatDate } from "@/lib/utils";
import { tenantBasePath } from "@/lib/tenant-url";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/system/empty-state";
import { CircleCheck } from "lucide-react";
import {
  SurfaceCard,
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
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CircleCheck />
              </EmptyMedia>
              <EmptyTitle>Nothing failed</EmptyTitle>
              <EmptyDescription>
                Vouchers that fail to deliver show up here for retry.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </SurfaceCardContent>
      </SurfaceCard>
    );
  }

  return (
    <SurfaceCard
      action={{ label: "View all", href: `${tenantBasePath(tenantSlug)}/admin/failed`, stretch: false }}
    >
      <SurfaceCardHeader>
        <SurfaceCardTitle>Failed Vouchers</SurfaceCardTitle>
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
