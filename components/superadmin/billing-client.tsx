"use client";

import { Tenant } from "@/types/schemas";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle } from "lucide-react";

interface BillingClientProps {
  tenants: Tenant[];
}

function formatNaira(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString()}`;
}

export function BillingClient({ tenants }: BillingClientProps) {
  const pastDueTenants = tenants.filter(
    (t) => t.subscriptionStatus === "past_due"
  );

  const getSubStatusVariant = (status: string | null) => {
    switch (status) {
      case "active":
        return "default";
      case "past_due":
        return "destructive";
      case "cancelled":
        return "secondary";
      case "pending":
        return "secondary";
      default:
        return "secondary";
    }
  };

  return (
    <div className="space-y-6">
      {pastDueTenants.length > 0 && (
        <Card className="p-4 border-destructive">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <h3 className="font-semibold text-destructive">
              Past Due ({pastDueTenants.length})
            </h3>
          </div>
          <p className="text-sm text-muted-foreground">
            These tenants have failed subscription payments. Consider suspending
            their accounts.
          </p>
          <div className="mt-3 space-y-2">
            {pastDueTenants.map((tenant) => (
              <div
                key={tenant.id}
                className="flex items-center justify-between text-sm"
              >
                <span className="font-medium">{tenant.businessName}</span>
                <span className="text-muted-foreground">
                  {formatNaira(tenant.monthlyFee)}/mo
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Business</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Monthly Fee</TableHead>
              <TableHead>Sub Status</TableHead>
              <TableHead>Next Billing</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tenants.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-muted-foreground py-8"
                >
                  No subscription tenants yet
                </TableCell>
              </TableRow>
            ) : (
              tenants.map((tenant) => (
                <TableRow key={tenant.id}>
                  <TableCell className="font-medium">
                    {tenant.businessName}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{tenant.planName}</Badge>
                  </TableCell>
                  <TableCell>{formatNaira(tenant.monthlyFee)}</TableCell>
                  <TableCell>
                    <Badge variant={getSubStatusVariant(tenant.subscriptionStatus)}>
                      {tenant.subscriptionStatus || "N/A"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {tenant.nextBillingDate
                      ? new Date(tenant.nextBillingDate).toLocaleDateString()
                      : "N/A"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
