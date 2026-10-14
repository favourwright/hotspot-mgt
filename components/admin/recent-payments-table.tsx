import { Payment } from "@/types/schemas";
import { formatDate, formatNaira } from "@/lib/utils";
import { tenantBasePath } from "@/lib/tenant-url";
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/system/empty-state";
import { Receipt } from "lucide-react";

interface RecentPaymentsTableProps {
  payments: Payment[];
  tenantSlug: string;
}

export function RecentPaymentsTable({
  payments,
  tenantSlug,
}: RecentPaymentsTableProps) {
  if (payments.length === 0) {
    return (
      <SurfaceCard>
        <SurfaceCardHeader>
          <SurfaceCardTitle>Recent Payments</SurfaceCardTitle>
        </SurfaceCardHeader>
        <SurfaceCardContent>
          <Empty>
            <EmptyHeader>
              {/* White tile on the sunken panel -- `bg-muted` would be the
                  same grey as the panel it sits on. */}
              <EmptyMedia variant="icon">
                <Receipt />
              </EmptyMedia>
              <EmptyTitle>No payments yet</EmptyTitle>
              <EmptyDescription>
                Payments appear here once customers start buying vouchers.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </SurfaceCardContent>
      </SurfaceCard>
    );
  }

  return (
    <SurfaceCard
      action={{
        label: "View all",
        href: `${tenantBasePath(tenantSlug)}/admin/transactions`,
      }}
    >
      <SurfaceCardHeader>
        <SurfaceCardTitle>Recent Payments</SurfaceCardTitle>
      </SurfaceCardHeader>
      <SurfaceCardContent>
        <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Plan</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Tenant Share</TableHead>
            <TableHead>Platform Share</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {payments.map((payment) => (
            <TableRow key={payment.id}>
              <TableCell className="text-sm text-muted-foreground">
                {formatDate(payment.createdAt)}
              </TableCell>
              <TableCell className="font-medium">
                {payment.userEmail}
              </TableCell>
              <TableCell>{payment.planName}</TableCell>
              <TableCell>{formatNaira(payment.amount)}</TableCell>
              <TableCell>
                {payment.subaccountCode
                  ? formatNaira(payment.tenantShareKobo || 0)
                  : "N/A"}
              </TableCell>
              <TableCell>
                {payment.subaccountCode
                  ? formatNaira(payment.platformShareKobo || 0)
                  : "N/A"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        </Table>
      </SurfaceCardContent>
    </SurfaceCard>
  );
}
