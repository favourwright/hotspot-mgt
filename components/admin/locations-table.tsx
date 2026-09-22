"use client";

import { useState } from "react";
import { useLocations, useToggleLocation } from "@/hooks/use-locations";
import { AddLocationDialog } from "./add-location-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";

interface LocationsTableProps {
  initialLocations: never[];
}

export function LocationsTable({ initialLocations }: LocationsTableProps) {
  const { data: locations, isLoading } = useLocations();
  const toggleLocation = useToggleLocation();
  const [dialogOpen, setDialogOpen] = useState(false);

  const maskIp = (ip: string) => {
    const parts = ip.split(".");
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.*.*`;
    }
    return ip;
  };

  const handleToggleActive = async (locationId: string, currentActive: boolean) => {
    try {
      await toggleLocation.mutateAsync({ id: locationId, active: !currentActive });
    } catch (error) {
      console.error("Toggle error:", error);
      alert("Failed to update location status");
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-gray-900"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Locations</h2>
          <p className="text-gray-600">Manage your hotspot locations</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>Add Location</Button>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Router IP</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {locations && locations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-gray-500">
                  No locations yet. Add your first location to get started.
                </TableCell>
              </TableRow>
            ) : (
              locations?.map((location) => (
                <TableRow key={location.id}>
                  <TableCell className="font-medium">{location.name}</TableCell>
                  <TableCell className="font-mono text-sm">
                    {maskIp(location.routerIp)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={location.active ? "default" : "secondary"}>
                      {location.active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {new Date(location.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleToggleActive(location.id, location.active)}
                      disabled={toggleLocation.isPending}
                    >
                      {toggleLocation.isPending && toggleLocation.variables?.id === location.id
                        ? "..."
                        : location.active
                        ? "Deactivate"
                        : "Activate"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <AddLocationDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSuccess={() => setDialogOpen(false)}
      />
    </div>
  );
}
