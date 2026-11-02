"use client"

import { useState } from "react"
import { Router } from "@/types/schemas"
import { useAuthStore } from "@/stores/auth-store"
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card"
import { PageHeader } from "@/components/system/page-header"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/system/button"
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/system/empty-state"
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
import { Plus, ServerCog, Trash2 } from "lucide-react"
import { RouterDialog } from "./router-dialog"
import { PlanLimitNotice } from "./plan-limit-notice"
import { isAtPlanLimit } from "@/lib/plan-resource-limits"
import { useRouters, useDeleteRouter } from "@/hooks/use-routers"
import { toast } from "@/components/ui/toast"

interface RoutersTableProps {
  initialRouters: Router[]
  tenantSlug: string
  routerLimit: number | null
  planName: string | null
}

export function RoutersTable({
  initialRouters,
  tenantSlug,
  routerLimit,
  planName,
}: RoutersTableProps) {
  const { userRole } = useAuthStore()
  const isSuperAdmin = userRole === "superadmin"
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [selectedRouter, setSelectedRouter] = useState<Router | null>(null)

  // Seeded with the server component's fetch for an instant first paint -
  // every mutation below invalidates this query, which refetches just this
  // list in the background, no full page reload needed.
  const { data: routers = initialRouters } = useRouters(initialRouters)
  const deleteRouter = useDeleteRouter()
  const atLimit = isAtPlanLimit(routers.length, routerLimit)

  const handleSuccess = () => {
    setDialogOpen(false)
  }

  const handleCreate = () => {
    setSelectedRouter(null)
    setDialogMode("create")
    setDialogOpen(true)
  }

  const handleEdit = (routerToEdit: Router) => {
    setSelectedRouter(routerToEdit)
    setDialogMode("edit")
    setDialogOpen(true)
  }

  const handleDeleteClick = (routerToDelete: Router) => {
    setSelectedRouter(routerToDelete)
    setDeleteDialogOpen(true)
  }

  const handleDeleteConfirm = async () => {
    if (!selectedRouter) return

    try {
      await deleteRouter.mutateAsync(selectedRouter.id)

      toast.add({
        title: "Router deleted",
        description: "Router removed successfully.",
        type: "success",
      })

      setDeleteDialogOpen(false)
      setSelectedRouter(null)
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to delete router"

      toast.add({
        title: "Failed to delete router",
        description: errorMessage,
        type: "error",
      })
    }
  }

  const getStatusVariant = (status: string) => {
    switch (status) {
      case "online":
        return "default"
      case "offline":
        return "destructive"
      case "pending":
        return "secondary"
      default:
        return "secondary"
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Routers"
        description={
          isSuperAdmin
            ? "Viewing as superadmin - read only"
            : "Manage your MikroTik routers"
        }
        action={
          !isSuperAdmin && (
            <Button tone="action" onClick={handleCreate} disabled={atLimit}>
              <Plus />
              Register router
            </Button>
          )
        }
      />

      {!isSuperAdmin && atLimit && routerLimit !== null && (
        <PlanLimitNotice
          limit="maxRouters"
          allowed={routerLimit}
          planName={planName}
          tenantSlug={tenantSlug}
        />
      )}

      <SurfaceCard>
        <SurfaceCardHeader>
          <SurfaceCardTitle>Routers</SurfaceCardTitle>
          <SurfaceCardDescription>
            {routers.length} {routers.length === 1 ? "router" : "routers"}
          </SurfaceCardDescription>
        </SurfaceCardHeader>
        <SurfaceCardContent>
          {routers.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ServerCog />
                </EmptyMedia>
                <EmptyTitle>No routers yet</EmptyTitle>
                <EmptyDescription>
                  Register your first MikroTik router to start managing
                  locations.
                </EmptyDescription>
              </EmptyHeader>
              {!isSuperAdmin && (
                <EmptyContent>
                  <Button tone="action" onClick={handleCreate}>
                    <Plus />
                    Register router
                  </Button>
                </EmptyContent>
              )}
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Connection</TableHead>
                  <TableHead>IP / Tunnel IP</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Active</TableHead>
                  {!isSuperAdmin && (
                    <TableHead className="text-right">Actions</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {routers.map((router) => (
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
                    {!isSuperAdmin && (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            tone="ghost"
                            scale="sm"
                            onClick={() => handleEdit(router)}
                          >
                            Edit
                          </Button>
                          <Button
                            tone="ghost"
                            scale="icon-sm"
                            aria-label={`Delete ${router.name}`}
                            onClick={() => handleDeleteClick(router)}
                          >
                            <Trash2 className="text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SurfaceCardContent>
      </SurfaceCard>

      {!isSuperAdmin && (
        <>
          <RouterDialog
            mode={dialogMode}
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            onSuccess={handleSuccess}
            router={selectedRouter}
          />

          <AlertDialog
            open={deleteDialogOpen}
            onOpenChange={setDeleteDialogOpen}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Router?</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete {selectedRouter?.name}? This
                  action cannot be undone. You can only delete routers that have
                  no associated locations.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDeleteConfirm}
                  variant="destructive"
                >
                  {deleteRouter.isPending ? "Deleting..." : "Delete"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  )
}
