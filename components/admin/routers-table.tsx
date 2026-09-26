"use client";

import { useState } from "react";
import { Router } from "@/types/schemas";
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
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty";
import { ServerCog } from "lucide-react";

interface RoutersTableProps {
  initialRouters: Router[];
  tenantSlug: string;
}

export function RoutersTable({ initialRouters }: RoutersTableProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const getStatusVariant = (status: string) => {
    switch (status) {
      case "online":
        return "default";
      case "offline":
        return "destructive";
      case "pending":
        return "secondary";
      default:
        return "secondary";
    }
  };

  if (initialRouters.length === 0) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-2xl font-bold">Routers</h2>
          <p className="text-gray-600">Manage your MikroTik routers</p>
        </div>
        <Card>
          <div className="py-12">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ServerCog />
                </EmptyMedia>
                <EmptyTitle>No Routers Yet</EmptyTitle>
                <EmptyDescription>
                  Register your first MikroTik router to start managing locations.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={() => setDialogOpen(true)}>
                  Register Router
                </Button>
              </EmptyContent>
            </Empty>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Routers</h2>
          <p className="text-gray-600">Manage your MikroTik routers</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>Register Router</Button>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Connection</TableHead>
              <TableHead>IP / Tunnel IP</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Active</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialRouters.map((router) => (
              <TableRow key={router.id}>
                <TableCell className="font-medium">{router.name}</TableCell>
                <TableCell>
                  <Badge
                    variant={
                      router.connectionMethod === "wireguard"
                        ? "default"
                        : "secondary"
                    }
                  >
                    {router.connectionMethod === "wireguard"
                      ? "WireGuard"
                      : "Direct IP"}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-sm">
                  {router.connectionMethod === "wireguard" &&
                  router.wireguardTunnelIp
                    ? router.wireguardTunnelIp
                    : router.routerIp}
                </TableCell>
                <TableCell>
                  <Badge variant={getStatusVariant(router.status)}>
                    {router.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={router.active ? "default" : "secondary"}>
                    {router.active ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm">
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* RegisterRouterDialog will be added in next phase */}
      {dialogOpen && (
        <div>Register Router Dialog - To be implemented</div>
      )}
    </div>
  );
}
