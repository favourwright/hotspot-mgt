"use client";

import Link from "next/link";
import { Voucher } from "@/types/schemas";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

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
      <Card className="p-6">
        <h3 className="font-semibold mb-4">Failed Vouchers</h3>
        <p className="text-sm text-muted-foreground">
          No failed vouchers.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold">Failed Vouchers</h3>
        <Link href={`/${tenantSlug}/admin/failed`}>
          <Button variant="outline" size="sm">
            View All
          </Button>
        </Link>
      </div>
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
    </Card>
  );
}
