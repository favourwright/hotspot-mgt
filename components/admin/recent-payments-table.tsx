import { Payment } from "@/types/schemas";
import { formatDate, formatNaira } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

interface RecentPaymentsTableProps {
  payments: Payment[];
}

export function RecentPaymentsTable({ payments }: RecentPaymentsTableProps) {
  if (payments.length === 0) {
    return (
      <Card className="p-6">
        <h3 className="font-semibold mb-4">Recent Payments</h3>
        <p className="text-sm text-muted-foreground">No payments yet.</p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <h3 className="font-semibold mb-4">Recent Payments</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Customer</TableHead>
            <TableHead>Plan</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Tenant Share</TableHead>
            <TableHead>Platform Share</TableHead>
            <TableHead>Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {payments.map((payment) => (
            <TableRow key={payment.id}>
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
              <TableCell className="text-sm text-muted-foreground">
                {formatDate(payment.createdAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
