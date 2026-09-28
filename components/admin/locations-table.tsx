"use client";

import { useState } from "react";
import { useToggleLocation, useDeleteLocation } from "@/hooks/use-locations";
import { useAuthStore } from "@/stores/auth-store";
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
import { Location, Plan, Router } from "@/types/schemas";
import { toast } from "@/components/ui/toast";
import { auth } from "@/lib/firebase";

interface LocationsTableProps {
  initialLocations: Location[];
  plans: Plan[];
  tenantSlug: string;
  routers: Router[];
}

export function LocationsTable({ initialLocations, plans, tenantSlug, routers }: LocationsTableProps) {
  const locations = initialLocations;
  const { userRole } = useAuthStore();
  const isSuperAdmin = userRole === "superadmin";
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

  const getRouterForLocation = (location: Location) => {
    return routers.find(r => r.id === location.routerId);
  };

  const locationHasPlans = (locationId: string) => {
    return plans.some(plan => plan.locationId === locationId);
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
      if (!auth || !auth.currentUser) {
        throw new Error("Not authenticated")
      }
      const token = await auth.currentUser.getIdToken()

      const response = await fetch(`/api/admin/locations/${locationId}/setup-expiry-system`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to verify connection")
      }

      toast.add({
        title: "Router connection verified",
        description: "Router connection verified successfully.",
        type: "success",
      })
    } catch (error) {
      console.error("Setup expiry error:", error)
      toast.add({
        title: "Verification failed",
        description: error instanceof Error ? error.message : "Unknown error occurred",
        type: "error",
      })
    } finally {
      setSettingUpExpiry(null)
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Locations</h2>
          <p className="text-gray-600">
            {isSuperAdmin ? "Viewing as superadmin — read only" : "Manage your hotspot locations"}
          </p>
        </div>
        {!isSuperAdmin && (
          <Button onClick={() => setDialogOpen(true)}>Add Location</Button>
        )}
      </div>

      {locations.length === 0 ? (
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
              {!isSuperAdmin && (
                <EmptyContent>
                  <Button onClick={() => setDialogOpen(true)}>Add Location</Button>
                </EmptyContent>
              )}
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
                {!isSuperAdmin && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {locations.map((location) => {
                const router = getRouterForLocation(location);
                return (
                  <TableRow key={location.id}>
                    <TableCell className="font-medium">
                      {location.name}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {router ? maskIp(router.routerIp) : 'N/A'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={location.active ? "default" : "secondary"}>
                        {location.active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {new Date(location.createdAt).toLocaleDateString()}
                    </TableCell>
                    {!isSuperAdmin && (
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
                              Verify Connection
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
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      {!isSuperAdmin && (
        <>
          <AddLocationDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            onSuccess={() => setDialogOpen(false)}
            routers={routers}
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
        </>
      )}
    </div>
  );
}
