"use client";

import { useState, useEffect } from "react";
import { auth } from "@/lib/firebase";
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

interface Location {
  id: string;
  name: string;
  routerIp: string;
  active: boolean;
  createdAt: string;
}

interface LocationsTableProps {
  initialLocations: Location[];
}

export function LocationsTable({ initialLocations }: LocationsTableProps) {
  const [locations, setLocations] = useState(initialLocations);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLocations();
  }, []);

  const fetchLocations = async () => {
    try {
      const user = auth?.currentUser;
      if (!user) return;

      const token = await user.getIdToken();

      const response = await fetch("/api/admin/locations", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const result = await response.json();

      if (result.success) {
        setLocations(result.data);
      }
    } catch (error) {
      console.error("Fetch error:", error);
    } finally {
      setLoading(false);
    }
  };

  const maskIp = (ip: string) => {
    const parts = ip.split(".");
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.*.*`;
    }
    return ip;
  };

  const handleToggleActive = async (locationId: string, currentActive: boolean) => {
    setToggling(locationId);

    try {
      const user = auth?.currentUser;
      if (!user) throw new Error("Not authenticated");

      const token = await user.getIdToken();

      const response = await fetch(`/api/admin/locations/${locationId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ active: !currentActive }),
      });

      const result = await response.json();

      if (result.success) {
        setLocations((prev) =>
          prev.map((loc) =>
            loc.id === locationId ? { ...loc, active: !currentActive } : loc
          )
        );
      } else {
        throw new Error(result.error || "Failed to update location");
      }
    } catch (error) {
      console.error("Toggle error:", error);
      alert("Failed to update location status");
    } finally {
      setToggling(null);
    }
  };

  const handleSuccess = async () => {
    // Refetch locations
    await fetchLocations();
  };

  if (loading) {
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
            {locations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-gray-500">
                  No locations yet. Add your first location to get started.
                </TableCell>
              </TableRow>
            ) : (
              locations.map((location) => (
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
                      disabled={toggling === location.id}
                    >
                      {toggling === location.id
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
        onSuccess={handleSuccess}
      />
    </div>
  );
}
