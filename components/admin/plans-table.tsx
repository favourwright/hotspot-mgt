"use client"

import { useState } from "react"
import { usePlans, useTogglePlan, useDeletePlan } from "@/hooks/use-plans"
import { useLocations } from "@/hooks/use-locations"
import { PlanDialog } from "./plan-dialog"
import { Button } from "@/components/ui/button"
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
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Card } from "@/components/ui/card"
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty"
import {
  MapPin,
  CreditCard,
  MoreHorizontal,
  Pencil,
  Trash2,
  AlertTriangle,
} from "lucide-react"
import { Plan } from "@/types/schemas"

interface Location {
  id: string
  name: string
}

interface PlansTableProps {
  initialPlans: never[]
  initialLocations: never[]
}

export function PlansTable({
  initialPlans,
  initialLocations,
}: PlansTableProps) {
  const { data: plans, isLoading: plansLoading } = usePlans()
  const { data: locations, isLoading: locationsLoading } = useLocations()
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

  const isLoading = plansLoading || locationsLoading

  // Set default filter to first location when locations load
  const effectiveLocationId = filterLocationId || locations?.[0]?.id || ""

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

  const formatPrice = (kobo: number) => {
    return `₦${(kobo / 100).toFixed(2)}`
  }

  const filteredPlans =
    plans?.filter((plan) => plan.locationId === effectiveLocationId) || []
  const currentLocation = locations?.find(
    (loc) => loc.id === effectiveLocationId
  )

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-gray-900"></div>
      </div>
    )
  }

  if (!locations || locations.length === 0) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-2xl font-bold">Plans</h2>
          <p className="text-gray-600">Manage your hotspot plans</p>
        </div>
        <Card>
          <div className="py-12">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MapPin />
                </EmptyMedia>
                <EmptyTitle>No Locations Found</EmptyTitle>
                <EmptyDescription>
                  You need to add a location before creating plans. Go to the
                  Locations page to add your first MikroTik router.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Plans</h2>
          <p className="text-gray-600">Manage your hotspot plans</p>
        </div>

        <div className="flex items-center gap-3">
          <Select
            value={effectiveLocationId}
            onValueChange={(value) => value && setFilterLocationId(value)}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue>
                {locations.find((loc) => loc.id === effectiveLocationId)
                  ?.name || "Select location"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {locations.map((location) => (
                <SelectItem key={location.id} value={location.id}>
                  {location.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            onClick={() => {
              setSelectedLocation(currentLocation || null)
              setDialogMode("create")
              setDialogOpen(true)
            }}
            disabled={!currentLocation}
          >
            Add Plan
          </Button>
        </div>
      </div>

      <Card>
        <div className="border-b p-4">
          <h3 className="font-semibold">
            {currentLocation?.name || "Select a location"} Plans
          </h3>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Plan Name</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Data Limit</TableHead>
              <TableHead>MikroTik Profile</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredPlans.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="p-0">
                  <Empty className="py-8">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <CreditCard />
                      </EmptyMedia>
                      <EmptyTitle className="text-base">
                        No Plans Yet
                      </EmptyTitle>
                      <EmptyDescription className="text-sm">
                        Create your first plan for this location to start
                        selling vouchers.
                      </EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent>
                      <Button
                        size="sm"
                        onClick={() => {
                          setSelectedLocation(currentLocation || null)
                          setDialogMode("create")
                          setDialogOpen(true)
                        }}
                        disabled={!currentLocation}
                      >
                        Add Plan
                      </Button>
                    </EmptyContent>
                  </Empty>
                </TableCell>
              </TableRow>
            ) : (
              filteredPlans.map((plan) => (
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
                        <DropdownMenuItem onClick={() => handleEditClick(plan)}>
                          Edit
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
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {selectedLocation && dialogMode === "create" && (
        <PlanDialog
          mode="create"
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSuccess={() => setDialogOpen(false)}
          locationId={selectedLocation.id}
          locationName={selectedLocation.name}
        />
      )}

      {dialogMode === "edit" && (
        <PlanDialog
          mode="edit"
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSuccess={() => setDialogOpen(false)}
          plan={selectedPlan}
        />
      )}

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
    </div>
  )
}
