"use client";

import Link from "next/link";
import { Tenant } from "@/types/schemas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  SurfaceCard,
} from "@/components/system/surface-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ExternalLink } from "lucide-react";

interface RecentTenantsTableProps {
  tenants: Tenant[];
}

export function RecentTenantsTable({ tenants }: RecentTenantsTableProps) {
  const getStatusVariant = (status: string) => {
    switch (status) {
      case "active":
        return "default";
      case "suspended":
        return "destructive";
      case "pending":
        return "secondary";
      default:
        return "secondary";
    }
  };

  return (
    <SurfaceCard>
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
                <Link href={`/${tenant.slug}/admin`} target="_blank">
                  <Button variant="ghost" size="sm">
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </SurfaceCard>
  );
}
