"use client"

import Link from "next/link"
import { Tenant } from "@/types/schemas"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/system/button"
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
import { Building2 } from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ExternalLink } from "lucide-react"

interface RecentTenantsTableProps {
  tenants: Tenant[]
}

export function RecentTenantsTable({ tenants }: RecentTenantsTableProps) {
  const getStatusVariant = (status: string) => {
    switch (status) {
      case "active":
        return "default"
      case "suspended":
        return "destructive"
      case "pending":
        return "secondary"
      default:
        return "secondary"
    }
  }

  return (
    <SurfaceCard>
      <SurfaceCardHeader>
        <SurfaceCardTitle>Recent tenants</SurfaceCardTitle>
        <SurfaceCardDescription>
          The {tenants.length} most recently created
        </SurfaceCardDescription>
      </SurfaceCardHeader>
      <SurfaceCardContent>
        {tenants.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Building2 />
              </EmptyMedia>
              <EmptyTitle>No tenants yet</EmptyTitle>
              <EmptyDescription>
                Businesses that sign up will appear here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Business</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.map((tenant) => (
                <TableRow key={tenant.id}>
                  <TableCell className="font-medium">
                    {tenant.businessName}
                  </TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">
                    /{tenant.slug}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{tenant.planName}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={getStatusVariant(tenant.status)}>
                      {tenant.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      tone="ghost"
                      scale="icon-sm"
                      nativeButton={false}
                      render={
                        <Link href={`/${tenant.slug}/admin`} target="_blank" />
                      }
                      aria-label={`Open ${tenant.businessName} admin`}
                    >
                      <ExternalLink />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SurfaceCardContent>
    </SurfaceCard>
  )
}
