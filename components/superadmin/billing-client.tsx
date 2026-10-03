"use client"

import { Tenant } from "@/types/schemas"
import { Badge } from "@/components/ui/badge"
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/system/empty-state"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { AlertTriangle, CreditCard } from "lucide-react"

interface BillingClientProps {
  tenants: Tenant[]
}

function formatNaira(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString()}`
}

export function BillingClient({ tenants }: BillingClientProps) {
  const pastDueTenants = tenants.filter(
    (t) => t.subscriptionStatus === "past_due"
  )

  const getSubStatusVariant = (status: string | null) => {
    switch (status) {
      case "active":
        return "default"
      case "past_due":
        return "destructive"
      case "cancelled":
        return "secondary"
      case "pending":
        return "secondary"
      default:
        return "secondary"
    }
  }

  return (
    <div className="space-y-6">
      {pastDueTenants.length > 0 && (
        <SurfaceCard>
          <SurfaceCardHeader>
            {/* Tone carried by the icon tile and the inset fill rather than
                a ring -- the system draws no borders. */}
            <SurfaceCardTitle className="flex items-center gap-2">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-destructive/15 text-destructive">
                <AlertTriangle className="size-4" />
              </span>
              Past due ({pastDueTenants.length})
            </SurfaceCardTitle>
            <SurfaceCardDescription>
              These tenants have failed subscription payments. Consider
              suspending their accounts.
            </SurfaceCardDescription>
          </SurfaceCardHeader>
          <SurfaceCardContent
            insetBackground="rgba(0,0,0,0.04)"
            className="space-y-2 text-sm"
          >
            {pastDueTenants.map((tenant) => (
              <div
                key={tenant.id}
                className="flex items-center justify-between"
              >
                <span className="font-medium">{tenant.businessName}</span>
                <span className="text-muted-foreground">
                  {formatNaira(tenant.monthlyFee)}/mo
                </span>
              </div>
            ))}
          </SurfaceCardContent>
        </SurfaceCard>
      )}

      <SurfaceCard>
        <SurfaceCardHeader>
          <SurfaceCardTitle>Subscriptions</SurfaceCardTitle>
          <SurfaceCardDescription>
            {tenants.length} paying{" "}
            {tenants.length === 1 ? "tenant" : "tenants"}
          </SurfaceCardDescription>
        </SurfaceCardHeader>
        <SurfaceCardContent>
          {tenants.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CreditCard />
                </EmptyMedia>
                <EmptyTitle>No subscriptions yet</EmptyTitle>
                <EmptyDescription>
                  Tenants on a paid plan will appear here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
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
                {tenants.map((tenant) => (
                  <TableRow key={tenant.id}>
                    <TableCell className="font-medium">
                      {tenant.businessName}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{tenant.planName}</Badge>
                    </TableCell>
                    <TableCell>{formatNaira(tenant.monthlyFee)}</TableCell>
                    <TableCell>
                      <Badge
                        variant={getSubStatusVariant(tenant.subscriptionStatus)}
                      >
                        {tenant.subscriptionStatus || "N/A"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {tenant.nextBillingDate
                        ? new Date(tenant.nextBillingDate).toLocaleDateString()
                        : "N/A"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SurfaceCardContent>
      </SurfaceCard>
    </div>
  )
}
