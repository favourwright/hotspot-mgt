"use client"

import { useState } from "react"
import { BillingPlan } from "@/types/schemas"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/system/button"
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/system/empty-state"
import { PageHeader } from "@/components/system/page-header"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/system/dropdown-menu"
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
import { toast } from "@/components/ui/toast"
import {
  Infinity,
  MapPin,
  MoreHorizontal,
  Plus,
  Router,
  Tags,
  Users,
} from "lucide-react"
import { auth } from "@/lib/firebase"
import { BillingPlanDialog } from "@/components/superadmin/billing-plan-dialog"

interface BillingPlansClientProps {
  initialPlans: BillingPlan[]
}

function formatNaira(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString()}`
}

function pricingSummary(plan: BillingPlan): string {
  switch (plan.billingModel) {
    case "free":
      return "Free"
    case "flat":
      return `${formatNaira(plan.monthlyFee)}/${plan.billingInterval === "yearly" ? "yr" : "mo"}`
    case "usage":
      return `${plan.platformFeePercent}% per sale`
    case "hybrid":
      return `${formatNaira(plan.monthlyFee)}/${plan.billingInterval === "yearly" ? "yr" : "mo"} + ${plan.platformFeePercent}%`
    default:
      return "-"
  }
}

/**
 * Each limit as an icon-led fact rather than a dot-joined string -- the
 * icon carries the category, so the label only has to carry the number,
 * and "unlimited" becomes a glyph instead of a bare ∞ character.
 */
function LimitsSummary({ plan }: { plan: BillingPlan }) {
  const limits = [
    { icon: MapPin, value: plan.limits.maxLocations, noun: "locations" },
    { icon: Router, value: plan.limits.maxRouters, noun: "routers" },
    { icon: Users, value: plan.limits.maxCustomers, noun: "customers" },
  ]

  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {limits.map(({ icon: Icon, value, noun }) => (
        <span key={noun} className="inline-flex items-center gap-1.5">
          <Icon className="size-3.5 shrink-0 text-muted-foreground" />
          {value ? (
            <>
              {value} {noun}
            </>
          ) : (
            <>
              <Infinity className="size-3.5 shrink-0" aria-label="Unlimited" />
              {noun}
            </>
          )}
        </span>
      ))}
    </span>
  )
}

export function BillingPlansClient({ initialPlans }: BillingPlansClientProps) {
  const [plans, setPlans] = useState(initialPlans)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create")
  const [editingPlan, setEditingPlan] = useState<BillingPlan | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<BillingPlan | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)

  const sorted = [...plans].sort((a, b) => a.sortOrder - b.sortOrder)

  const handleCreate = () => {
    setDialogMode("create")
    setEditingPlan(null)
    setDialogOpen(true)
  }

  const handleEdit = (plan: BillingPlan) => {
    setDialogMode("edit")
    setEditingPlan(plan)
    setDialogOpen(true)
  }

  const handleSaved = (plan: BillingPlan) => {
    setPlans((prev) => {
      const exists = prev.some((p) => p.id === plan.id)
      return exists
        ? prev.map((p) => (p.id === plan.id ? plan : p))
        : [...prev, plan]
    })
    toast.add({
      title:
        dialogMode === "create"
          ? "Billing plan created"
          : "Billing plan updated",
      type: "success",
    })
  }

  const handleRestore = async (plan: BillingPlan) => {
    setLoadingId(plan.id)
    try {
      if (!auth?.currentUser) throw new Error("Not authenticated")
      const token = await auth.currentUser.getIdToken()
      const response = await fetch(
        `/api/superadmin/billing-plans/${plan.id}/restore`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        }
      )
      const data = await response.json()
      if (!data.success) throw new Error(data.error)

      setPlans((prev) => prev.map((p) => (p.id === plan.id ? data.data : p)))
      toast.add({ title: "Billing plan restored", type: "success" })
    } catch (err) {
      toast.add({
        title: "Failed to restore plan",
        description: err instanceof Error ? err.message : "Unknown error",
        type: "error",
      })
    } finally {
      setLoadingId(null)
    }
  }

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return
    const plan = deleteTarget
    setLoadingId(plan.id)
    try {
      if (!auth?.currentUser) throw new Error("Not authenticated")
      const token = await auth.currentUser.getIdToken()
      const response = await fetch(`/api/superadmin/billing-plans/${plan.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await response.json()
      if (!data.success) throw new Error(data.error)

      if (data.data?.hardDeleted) {
        setPlans((prev) => prev.filter((p) => p.id !== plan.id))
        toast.add({ title: "Billing plan deleted", type: "success" })
      } else {
        setPlans((prev) =>
          prev.map((p) =>
            p.id === plan.id
              ? { ...p, active: false, archivedAt: new Date() }
              : p
          )
        )
        const n = data.data?.tenantCount ?? 0
        toast.add({
          title: "Billing plan archived instead of deleted",
          description: `${n} tenant${n === 1 ? " is" : "s are"} still on this plan, so it was archived (hidden from new signups) rather than permanently removed.`,
          type: "success",
        })
      }
    } catch (err) {
      toast.add({
        title: "Failed to delete plan",
        description: err instanceof Error ? err.message : "Unknown error",
        type: "error",
      })
    } finally {
      setLoadingId(null)
      setDeleteTarget(null)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing plans"
        description="Create and manage the subscription tiers tenants can choose from"
        action={
          <Button tone="action" onClick={handleCreate}>
            <Plus />
            Add billing plan
          </Button>
        }
      />

      <SurfaceCard>
        <SurfaceCardHeader>
          <SurfaceCardTitle>Billing plans</SurfaceCardTitle>
          <SurfaceCardDescription>
            {plans.length} {plans.length === 1 ? "plan" : "plans"}
          </SurfaceCardDescription>
        </SurfaceCardHeader>
        <SurfaceCardContent>
          {sorted.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Tags />
                </EmptyMedia>
                <EmptyTitle>No billing plans yet</EmptyTitle>
                <EmptyDescription>
                  Create a plan to give businesses something to subscribe to.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Pricing</TableHead>
                  <TableHead>Limits</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((plan) => (
                  <TableRow key={plan.id}>
                    <TableCell className="font-medium">
                      {plan.name}
                      {plan.badge && (
                        <Badge variant="secondary" className="ml-2 text-xs">
                          {plan.badge}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground capitalize">
                      {plan.billingModel}
                    </TableCell>
                    <TableCell className="text-sm">
                      {pricingSummary(plan)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <LimitsSummary plan={plan} />
                    </TableCell>
                    <TableCell>
                      <Badge variant={plan.active ? "default" : "secondary"}>
                        {plan.active ? "Active" : "Archived"}
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
                              disabled={loadingId === plan.id}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleEdit(plan)}>
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {plan.active ? (
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => setDeleteTarget(plan)}
                            >
                              Delete
                            </DropdownMenuItem>
                          ) : (
                            <>
                              <DropdownMenuItem
                                onClick={() => handleRestore(plan)}
                              >
                                Restore
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() => setDeleteTarget(plan)}
                              >
                                Delete Permanently
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SurfaceCardContent>
      </SurfaceCard>

      <BillingPlanDialog
        mode={dialogMode}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={handleSaved}
        plan={editingPlan}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Billing Plan</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{deleteTarget?.name}&quot;?
              If no tenant is currently on this plan, it&apos;s removed
              permanently. If any tenant still is, it&apos;s archived instead
              (hidden from new signups, but existing tenants on it are
              unaffected) rather than deleted outright, since that would break
              their billing record.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loadingId === deleteTarget?.id}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={loadingId === deleteTarget?.id}
              variant="destructive"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
