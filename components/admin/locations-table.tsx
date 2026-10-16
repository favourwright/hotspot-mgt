"use client"

import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  useLocations,
  useToggleLocation,
  useDeleteLocation,
  LOCATIONS_QUERY_KEY,
} from "@/hooks/use-locations"
import { useAuthStore } from "@/stores/auth-store"
import { AddLocationDialog } from "./add-location-dialog"
import { PortalProgressDialog } from "./portal-progress-dialog"
import { Button } from "@/components/system/button"
import { Badge } from "@/components/ui/badge"
import { formatDay } from "@/lib/utils"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/system/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/system/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card"
import { PageHeader } from "@/components/system/page-header"
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/system/empty-state"
import {
  MapPin,
  MoreHorizontal,
  Plus,
  Shield,
  Wifi,
  WifiOff,
} from "lucide-react"
import { Location, Plan, Router } from "@/types/schemas"
import { toast } from "@/components/ui/toast"
import { auth } from "@/lib/firebase"

interface LocationsTableProps {
  initialLocations: Location[]
  plans: Plan[]
  tenantSlug: string
  routers: Router[]
}

export function LocationsTable({
  initialLocations,
  plans,
  tenantSlug,
  routers,
}: LocationsTableProps) {
  // Seeded with the server component's fetch for an instant first paint -
  // every mutation below invalidates this query, which refetches just this
  // list in the background, no full page reload needed.
  const { data: locations = initialLocations } = useLocations(initialLocations)
  const { userRole } = useAuthStore()
  const isSuperAdmin = userRole === "superadmin"
  const toggleLocation = useToggleLocation()
  const deleteLocation = useDeleteLocation()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [locationToDelete, setLocationToDelete] = useState<Location | null>(
    null
  )
  const [settingUpExpiry, setSettingUpExpiry] = useState<string | null>(null)
  const [portalBusy, setPortalBusy] = useState<string | null>(null)
  // Which direction is in flight, for the blocking progress dialog. The
  // dropdown closes the moment it's clicked, so `portalBusy` alone was never
  // visible to anyone.
  const [portalAction, setPortalAction] = useState<
    "install" | "uninstall" | null
  >(null)
  const queryClient = useQueryClient()

  const maskIp = (ip: string) => {
    const parts = ip.split(".")
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.*.*`
    }
    return ip
  }

  const getRouterForLocation = (location: Location) => {
    return routers.find((r) => r.id === location.routerId)
  }

  const locationHasPlans = (locationId: string) => {
    return plans.some((plan) => plan.locationId === locationId)
  }

  const handleToggleActive = async (
    locationId: string,
    currentActive: boolean
  ) => {
    try {
      await toggleLocation.mutateAsync({
        id: locationId,
        active: !currentActive,
      })
    } catch (error) {
      console.error("Toggle error:", error)
      alert("Failed to update location status")
    }
  }

  const handleDeleteClick = (location: Location) => {
    setLocationToDelete(location)
    setDeleteDialogOpen(true)
  }

  const handleConfirmDelete = async () => {
    if (!locationToDelete) return

    try {
      await deleteLocation.mutateAsync(locationToDelete.id)
      setDeleteDialogOpen(false)
      setLocationToDelete(null)
    } catch (error) {
      console.error("Delete error:", error)
      alert("Failed to delete location")
    }
  }

  /**
   * Installs or removes the captive portal on a location's router.
   *
   * One handler for both directions: they differ only by endpoint and
   * wording, and keeping them together means the loading state and error
   * handling can't drift apart.
   */
  const handlePortal = async (
    locationId: string,
    action: "install" | "uninstall"
  ) => {
    setPortalBusy(locationId)
    setPortalAction(action)
    try {
      if (!auth || !auth.currentUser) {
        throw new Error("Not authenticated")
      }
      const token = await auth.currentUser.getIdToken()

      const response = await fetch(
        `/api/admin/locations/${locationId}/${action}-portal`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } }
      )

      const result = await response.json()

      // 402 is the addon paywall, not a failure to configure anything. It
      // gets its own message with somewhere to go: an error telling someone
      // they need to buy something, without saying where, is a dead end.
      if (response.status === 402 && result.data?.addonRequired) {
        toast.add({
          title: "Captive Portal addon required",
          description:
            "Installing the portal needs the Captive Portal addon. You can add it from the Addons page.",
          type: "warning",
        })
        return
      }

      if (!response.ok || !result.success) {
        throw new Error(result.error || `Failed to ${action} the portal`)
      }

      if (action === "install") {
        const failed: string[] = result.data?.walledGarden?.failed ?? []
        toast.add({
          title: "Portal installed",
          description: failed.length
            ? `Customers now see your portal. ${failed.length} walled-garden ${failed.length === 1 ? "host" : "hosts"} couldn't be added, so parts of it may not load.`
            : "Customers connecting to this location now see your branded portal.",
          type: failed.length ? "warning" : "success",
        })
      } else {
        toast.add({
          title: "Portal removed",
          description: `The hotspot is back on its previous pages (${result.data?.restoredTo}).`,
          type: "success",
        })
      }

      await queryClient.invalidateQueries({ queryKey: LOCATIONS_QUERY_KEY })
    } catch (error) {
      toast.add({
        title: `Couldn't ${action} the portal`,
        description: error instanceof Error ? error.message : "Unknown error",
        type: "error",
      })
    } finally {
      setPortalBusy(null)
      setPortalAction(null)
    }
  }

  const handleSetupExpiry = async (locationId: string) => {
    setSettingUpExpiry(locationId)
    try {
      if (!auth || !auth.currentUser) {
        throw new Error("Not authenticated")
      }
      const token = await auth.currentUser.getIdToken()

      const response = await fetch(
        `/api/admin/locations/${locationId}/setup-expiry-system`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      )

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
        description:
          error instanceof Error ? error.message : "Unknown error occurred",
        type: "error",
      })
    } finally {
      setSettingUpExpiry(null)
    }
  }

  return (
    <div className="space-y-6">
      <PortalProgressDialog action={portalAction} />

      <PageHeader
        title="Locations"
        description={
          isSuperAdmin
            ? "Viewing as superadmin - read only"
            : "Manage your hotspot locations"
        }
        action={
          !isSuperAdmin && (
            <Button tone="action" onClick={() => setDialogOpen(true)}>
              <Plus />
              Add location
            </Button>
          )
        }
      />

      <SurfaceCard>
        <SurfaceCardHeader>
          <SurfaceCardTitle>Locations</SurfaceCardTitle>
          <SurfaceCardDescription>
            {locations.length}{" "}
            {locations.length === 1 ? "location" : "locations"}
          </SurfaceCardDescription>
        </SurfaceCardHeader>
        <SurfaceCardContent>
          {locations.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MapPin />
                </EmptyMedia>
                <EmptyTitle>No locations yet</EmptyTitle>
                <EmptyDescription>
                  Add your first MikroTik router location to start selling
                  internet vouchers.
                </EmptyDescription>
              </EmptyHeader>
              {!isSuperAdmin && (
                <EmptyContent>
                  <Button tone="action" onClick={() => setDialogOpen(true)}>
                    <Plus />
                    Add location
                  </Button>
                </EmptyContent>
              )}
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Router IP</TableHead>
                  <TableHead>Status</TableHead>
                  {!isSuperAdmin && (
                    <TableHead className="text-right">Actions</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {locations.map((location) => {
                  const router = getRouterForLocation(location)
                  return (
                    <TableRow key={location.id}>
                      <TableCell>
                        {formatDay(new Date(location.createdAt))}
                      </TableCell>
                      <TableCell className="font-medium">
                        {location.name}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {router ? maskIp(router.routerIp) : "N/A"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={location.active ? "default" : "secondary"}
                        >
                          {location.active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      {!isSuperAdmin && (
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <Button tone="ghost" scale="icon-sm">
                                  <MoreHorizontal />
                                  <span className="sr-only">Open menu</span>
                                </Button>
                              }
                            />
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => handleSetupExpiry(location.id)}
                                disabled={settingUpExpiry === location.id}
                              >
                                <Shield
                                  className={`mr-2 h-4 w-4 ${settingUpExpiry === location.id ? "animate-pulse" : ""}`}
                                />
                                Verify Connection
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {location.portalInstalledAt ? (
                                <DropdownMenuItem
                                  onClick={() =>
                                    handlePortal(location.id, "uninstall")
                                  }
                                  disabled={portalBusy === location.id}
                                >
                                  <WifiOff className="mr-2 h-4 w-4" />
                                  Remove captive portal
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem
                                  onClick={() =>
                                    handlePortal(location.id, "install")
                                  }
                                  disabled={portalBusy === location.id}
                                >
                                  <Wifi className="mr-2 h-4 w-4" />
                                  Install captive portal
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() =>
                                  handleToggleActive(
                                    location.id,
                                    location.active
                                  )
                                }
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
                  )
                })}
              </TableBody>
            </Table>
          )}
        </SurfaceCardContent>
      </SurfaceCard>

      {!isSuperAdmin && (
        <>
          <AddLocationDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            onSuccess={() => setDialogOpen(false)}
            routers={routers}
            locations={locations}
          />

          <AlertDialog
            open={deleteDialogOpen}
            onOpenChange={setDeleteDialogOpen}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Location</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete &quot;{locationToDelete?.name}
                  &quot;? This action cannot be undone. All associated plans and
                  vouchers will be affected.
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
  )
}
