"use client";

import { useState } from "react";
import { useLocations, useToggleLocation, useDeleteLocation } from "@/hooks/use-locations";
import { usePlans } from "@/hooks/use-plans";
import { AddLocationDialog } from "./add-location-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty";
import { MapPin, MoreHorizontal, Shield } from "lucide-react";
import { Location } from "@/types/schemas";
import { toast } from "@/components/ui/toast";
import { auth } from "@/lib/firebase";

interface LocationsTableProps {
  initialLocations: never[];
}

export function LocationsTable({ initialLocations }: LocationsTableProps) {
  const { data: locations, isLoading } = useLocations();
  const { data: plans } = usePlans();
  const toggleLocation = useToggleLocation();
  const deleteLocation = useDeleteLocation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [locationToDelete, setLocationToDelete] = useState<Location | null>(null);
  const [settingUpExpiry, setSettingUpExpiry] = useState<string | null>(null);

  const maskIp = (ip: string) => {
    const parts = ip.split(".");
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.*.*`;
    }
    return ip;
  };

  const locationHasPlans = (locationId: string) => {
    return plans?.some(plan => plan.locationId === locationId) ?? false;
  };

  const handleToggleActive = async (locationId: string, currentActive: boolean) => {
    try {
      await toggleLocation.mutateAsync({ id: locationId, active: !currentActive });
    } catch (error) {
      console.error("Toggle error:", error);
      alert("Failed to update location status");
    }
  };

  const handleDeleteClick = (location: Location) => {
    setLocationToDelete(location);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!locationToDelete) return;

    try {
      await deleteLocation.mutateAsync(locationToDelete.id);
      setDeleteDialogOpen(false);
      setLocationToDelete(null);
    } catch (error) {
      console.error("Delete error:", error);
      alert("Failed to delete location");
    }
  };

  const handleSetupExpiry = async (locationId: string) => {
    setSettingUpExpiry(locationId)
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) {
        throw new Error("Not authenticated")
      }

      const response = await fetch(`/api/admin/locations/${locationId}/setup-expiry-system`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to setup expiry system")
      }

      toast.add({
        title: "Expiry system configured",
        description: "The expiry checker and scheduler have been set up on the router.",
        type: "success",
      })
    } catch (error) {
      console.error("Setup expiry error:", error)
      toast.add({
        title: "Setup failed",
        description: error instanceof Error ? error.message : "Unknown error occurred",
        type: "error",
      })
    } finally {
      setSettingUpExpiry(null)
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

      {locations && locations.length === 0 ? (
        <Card>
          <div className="py-12">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MapPin />
                </EmptyMedia>
                <EmptyTitle>No Locations Yet</EmptyTitle>
                <EmptyDescription>
                  Add your first MikroTik router location to start selling internet vouchers.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={() => setDialogOpen(true)}>Add Location</Button>
              </EmptyContent>
            </Empty>
          </div>
        </Card>
      ) : (
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
              {locations?.map((location) => (
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
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">Open menu</span>
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => handleSetupExpiry(location.id)}
                          disabled={settingUpExpiry === location.id}
                        >
                          <Shield className={`mr-2 h-4 w-4 ${settingUpExpiry === location.id ? "animate-pulse" : ""}`} />
                          Setup Expiry System
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => handleToggleActive(location.id, location.active)}
                          disabled={toggleLocation.isPending}
                        >
                          {location.active ? "Deactivate" : "Activate"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => handleDeleteClick(location)}
                          disabled={locationHasPlans(location.id)}
                        >
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <AddLocationDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSuccess={() => setDialogOpen(false)}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Location</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{locationToDelete?.name}&quot;?
              This action cannot be undone. All associated plans and vouchers will be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLocation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={deleteLocation.isPending}
              variant="destructive"
            >
              {deleteLocation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
