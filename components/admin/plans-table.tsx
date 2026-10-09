"use client"

import { useState } from "react"
import { usePlans, useTogglePlan, useDeletePlan } from "@/hooks/use-plans"
import { useAuthStore } from "@/stores/auth-store"
import { PlanDialog } from "./plan-dialog"
import { Button } from "@/components/system/button"
import { Badge } from "@/components/ui/badge"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/system/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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
  ChevronDown,
  CreditCard,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  AlertTriangle,
  RefreshCw,
} from "lucide-react"
import { Plan } from "@/types/schemas"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { toast } from "@/components/ui/toast"
import { auth } from "@/lib/firebase"

interface Location {
  id: string
  name: string
  /**
   * Carried through because a plan's visibility to customers depends on it,
   * not just on the plan's own `active` flag -- the storefront groups plans
   * by *active* location (components/tenant/customer-home.tsx), so an active
   * plan at a deactivated location is invisible while still looking fine in
   * every admin count.
   */
  active?: boolean
}

interface PlansTableProps {
  initialPlans: Plan[];
  initialLocations: Location[];
  tenantSlug: string;
}

export function PlansTable({
  initialPlans,
  initialLocations,
  tenantSlug,
}: PlansTableProps) {
  // Seeded with the server component's fetch for an instant first paint -
  // every mutation below invalidates this query, which refetches just this
  // list in the background, no full page reload needed.
  const { data: plans = initialPlans } = usePlans(undefined, initialPlans)
  const locations = initialLocations
  const { userRole } = useAuthStore()
  const isSuperAdmin = userRole === "superadmin"
  const togglePlan = useTogglePlan()
  const deletePlan = useDeletePlan()
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(
    null
  )
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null)
  const [planToDelete, setPlanToDelete] = useState<Plan | null>(null)
  const [filterLocationId, setFilterLocationId] = useState<string>("")
  const [refreshingScript, setRefreshingScript] = useState<string | null>(null)

  // Set default filter to first location when locations load
  const effectiveLocationId = filterLocationId || locations[0]?.id || ""

  const handleToggleActive = async (planId: string, currentActive: boolean) => {
    try {
      await togglePlan.mutateAsync({ id: planId, active: !currentActive })
    } catch (error) {
      console.error("Toggle error:", error)
      alert("Failed to update plan status")
    }
  }

  const handleEditClick = (plan: Plan) => {
    setSelectedPlan(plan)
    setDialogMode("edit")
    setDialogOpen(true)
  }

  const handleDeleteClick = (plan: Plan) => {
    setPlanToDelete(plan)
    setDeleteDialogOpen(true)
  }

  const handleConfirmDelete = async () => {
    if (!planToDelete) return

    try {
      await deletePlan.mutateAsync(planToDelete.id)
      setDeleteDialogOpen(false)
      setPlanToDelete(null)
    } catch (error) {
      console.error("Delete error:", error)
      alert("Failed to delete plan")
    }
  }

  const handleRefreshScript = async (planId: string) => {
    setRefreshingScript(planId)
    try {
      if (!auth || !auth.currentUser) {
        throw new Error("Not authenticated")
      }
      const token = await auth.currentUser.getIdToken()

      const response = await fetch(`/api/admin/plans/${planId}/push-login-script`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to refresh script")
      }

      toast.add({
        title: "Expiry script refreshed",
        description: "The on-login script has been updated on the router.",
        type: "success",
      })
    } catch (error) {
      console.error("Refresh script error:", error)
      toast.add({
        title: "Failed to refresh",
        description: error instanceof Error ? error.message : "Unknown error occurred",
        type: "error",
      })
    } finally {
      setRefreshingScript(null)
    }
  }

  const formatPrice = (kobo: number) => {
    return `₦${(kobo / 100).toFixed(2)}`
  }

  const filteredPlans =
    plans.filter((plan) => plan.locationId === effectiveLocationId)
  const currentLocation = locations.find(
    (loc) => loc.id === effectiveLocationId
  )

  if (locations.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Plans" description="Manage your hotspot plans" />
        <SurfaceCard>
          <SurfaceCardContent>
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MapPin />
                </EmptyMedia>
                <EmptyTitle>No locations yet</EmptyTitle>
                <EmptyDescription>
                  You need a location before you can create plans. Add your
                  first MikroTik router on the Locations page.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </SurfaceCardContent>
        </SurfaceCard>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Plans"
        description={
          isSuperAdmin
            ? "Viewing as superadmin - read only"
            : "Manage your hotspot plans"
        }
        action={
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button tone="raised" />}
                className="w-[200px] justify-between"
              >
                <span className="truncate">
                  {locations.find((loc) => loc.id === effectiveLocationId)
                    ?.name || "Select location"}
                </span>
                <ChevronDown />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[200px]">
                <DropdownMenuRadioGroup
                  value={effectiveLocationId}
                  onValueChange={(value) => value && setFilterLocationId(value)}
                >
                  {locations.map((location) => (
                    <DropdownMenuRadioItem
                      key={location.id}
                      value={location.id}
                    >
                      {location.name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            {!isSuperAdmin && (
              <Button
                tone="action"
                onClick={() => {
                  setSelectedLocation(currentLocation || null)
                  setDialogMode("create")
                  setDialogOpen(true)
                }}
                disabled={!currentLocation}
              >
                <Plus />
                Add plan
              </Button>
            )}
          </div>
        }
      />

      <SurfaceCard>
        <SurfaceCardHeader>
          <SurfaceCardTitle>
            {currentLocation?.name || "Select a location"}
          </SurfaceCardTitle>
          <SurfaceCardDescription>
            {filteredPlans.length} {filteredPlans.length === 1 ? "plan" : "plans"}
          </SurfaceCardDescription>
        </SurfaceCardHeader>
        <SurfaceCardContent>
          {currentLocation?.active === false && filteredPlans.length > 0 && (
            // The failure this prevents: an owner creates a plan, sees it
            // listed here and counted on the dashboard, opens their portal
            // and finds an empty state -- with nothing anywhere connecting
            // the two. Withholding the plan is correct; being silent is not.
            <Alert className="mb-4">
              <AlertTriangle className="size-4" />
              <AlertDescription>
                <strong>{currentLocation.name} is inactive</strong>, so none of
                these plans appear on your portal, even the active ones.
                Reactivate the location on the Locations page to start selling
                them.
              </AlertDescription>
            </Alert>
          )}
          {filteredPlans.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CreditCard />
                </EmptyMedia>
                <EmptyTitle>No plans yet</EmptyTitle>
                <EmptyDescription>
                  Create your first plan for this location to start selling
                  vouchers.
                </EmptyDescription>
              </EmptyHeader>
              {!isSuperAdmin && (
                <EmptyContent>
                  <Button
                    tone="action"
                    scale="sm"
                    onClick={() => {
                      setSelectedLocation(currentLocation || null)
                      setDialogMode("create")
                      setDialogOpen(true)
                    }}
                    disabled={!currentLocation}
                  >
                    <Plus />
                    Add plan
                  </Button>
                </EmptyContent>
              )}
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plan Name</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Data Limit</TableHead>
                  <TableHead>MikroTik Profile</TableHead>
                  <TableHead>Status</TableHead>
                  {!isSuperAdmin && (
                    <TableHead className="text-right">Actions</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPlans.map((plan) => (
                <TableRow key={plan.id}>
                  <TableCell className="font-medium">{plan.name}</TableCell>
                  <TableCell>{formatPrice(plan.price)}</TableCell>
                  <TableCell>{plan.duration}</TableCell>
                  <TableCell>{plan.dataLimit}</TableCell>
                  <TableCell className="font-mono text-sm">
                    {plan.mikrotikProfile}
                  </TableCell>
                  <TableCell>
                    <Badge variant={plan.active ? "default" : "secondary"}>
                      {plan.active ? "Active" : "Inactive"}
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
                          <DropdownMenuItem onClick={() => handleEditClick(plan)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleRefreshScript(plan.id)}
                            disabled={refreshingScript === plan.id}
                          >
                            <RefreshCw className={`mr-2 h-4 w-4 ${refreshingScript === plan.id ? "animate-spin" : ""}`} />
                            Refresh Expiry Script
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              handleToggleActive(plan.id, plan.active)
                            }
                            disabled={togglePlan.isPending}
                          >
                            {plan.active ? "Deactivate" : "Activate"}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => handleDeleteClick(plan)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SurfaceCardContent>
      </SurfaceCard>

      {!isSuperAdmin && selectedLocation && dialogMode === "create" && (
        <PlanDialog
          mode="create"
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSuccess={() => setDialogOpen(false)}
          locationId={selectedLocation.id}
          locationName={selectedLocation.name}
        />
      )}

      {!isSuperAdmin && dialogMode === "edit" && (
        <PlanDialog
          mode="edit"
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSuccess={() => setDialogOpen(false)}
          plan={selectedPlan}
        />
      )}

      {!isSuperAdmin && (
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Plan</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete &quot;{planToDelete?.name}&quot;?
                This action cannot be undone. Customers will no longer be able to
                purchase this plan.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deletePlan.isPending}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirmDelete}
                disabled={deletePlan.isPending}
                variant="destructive"
              >
                {deletePlan.isPending ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  )
}
