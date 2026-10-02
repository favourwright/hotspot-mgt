"use client";

import { useState } from "react";
import { BillingPlan } from "@/types/schemas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  SurfaceCard,
} from "@/components/system/surface-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { toast } from "@/components/ui/toast";
import { MoreHorizontal, Plus } from "lucide-react";
import { auth } from "@/lib/firebase";
import { BillingPlanDialog } from "@/components/superadmin/billing-plan-dialog";

interface BillingPlansClientProps {
  initialPlans: BillingPlan[];
}

function formatNaira(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString()}`;
}

function pricingSummary(plan: BillingPlan): string {
  switch (plan.billingModel) {
    case "free":
      return "Free";
    case "flat":
      return `${formatNaira(plan.monthlyFee)}/${plan.billingInterval === "yearly" ? "yr" : "mo"}`;
    case "usage":
      return `${plan.platformFeePercent}% per sale`;
    case "hybrid":
      return `${formatNaira(plan.monthlyFee)}/${plan.billingInterval === "yearly" ? "yr" : "mo"} + ${plan.platformFeePercent}%`;
    default:
      return "-";
  }
}

function limitsSummary(plan: BillingPlan): string {
  const parts = [
    plan.limits.maxLocations ? `${plan.limits.maxLocations} loc` : "∞ loc",
    plan.limits.maxRouters ? `${plan.limits.maxRouters} routers` : "∞ routers",
    plan.limits.maxCustomers ? `${plan.limits.maxCustomers} customers` : "∞ customers",
  ];
  return parts.join(" · ");
}

export function BillingPlansClient({ initialPlans }: BillingPlansClientProps) {
  const [plans, setPlans] = useState(initialPlans);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [editingPlan, setEditingPlan] = useState<BillingPlan | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BillingPlan | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const sorted = [...plans].sort((a, b) => a.sortOrder - b.sortOrder);

  const handleCreate = () => {
    setDialogMode("create");
    setEditingPlan(null);
    setDialogOpen(true);
  };

  const handleEdit = (plan: BillingPlan) => {
    setDialogMode("edit");
    setEditingPlan(plan);
    setDialogOpen(true);
  };

  const handleSaved = (plan: BillingPlan) => {
    setPlans((prev) => {
      const exists = prev.some((p) => p.id === plan.id);
      return exists ? prev.map((p) => (p.id === plan.id ? plan : p)) : [...prev, plan];
    });
    toast.add({
      title: dialogMode === "create" ? "Billing plan created" : "Billing plan updated",
      type: "success",
    });
  };

  const handleRestore = async (plan: BillingPlan) => {
    setLoadingId(plan.id);
    try {
      if (!auth?.currentUser) throw new Error("Not authenticated");
      const token = await auth.currentUser.getIdToken();
      const response = await fetch(`/api/superadmin/billing-plans/${plan.id}/restore`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error);

      setPlans((prev) => prev.map((p) => (p.id === plan.id ? data.data : p)));
      toast.add({ title: "Billing plan restored", type: "success" });
    } catch (err) {
      toast.add({
        title: "Failed to restore plan",
        description: err instanceof Error ? err.message : "Unknown error",
        type: "error",
      });
    } finally {
      setLoadingId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const plan = deleteTarget;
    setLoadingId(plan.id);
    try {
      if (!auth?.currentUser) throw new Error("Not authenticated");
      const token = await auth.currentUser.getIdToken();
      const response = await fetch(`/api/superadmin/billing-plans/${plan.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error);

      if (data.data?.hardDeleted) {
        setPlans((prev) => prev.filter((p) => p.id !== plan.id));
        toast.add({ title: "Billing plan deleted", type: "success" });
      } else {
        setPlans((prev) =>
          prev.map((p) =>
            p.id === plan.id ? { ...p, active: false, archivedAt: new Date() } : p
          )
        );
        const n = data.data?.tenantCount ?? 0;
        toast.add({
          title: "Billing plan archived instead of deleted",
          description: `${n} tenant${n === 1 ? " is" : "s are"} still on this plan, so it was archived (hidden from new signups) rather than permanently removed.`,
          type: "success",
        });
      }
    } catch (err) {
      toast.add({
        title: "Failed to delete plan",
        description: err instanceof Error ? err.message : "Unknown error",
        type: "error",
      });
    } finally {
      setLoadingId(null);
      setDeleteTarget(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={handleCreate}>
          <Plus className="h-4 w-4 mr-2" />
          Add Billing Plan
        </Button>
      </div>

      <SurfaceCard>
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
            {sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No billing plans yet. Create one to get started.
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((plan) => (
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
                  <TableCell className="text-sm">{pricingSummary(plan)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {limitsSummary(plan)}
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
                            <DropdownMenuItem onClick={() => handleRestore(plan)}>
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
              ))
            )}
          </TableBody>
        </Table>
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
              Are you sure you want to delete &quot;{deleteTarget?.name}&quot;? If no tenant is
              currently on this plan, it&apos;s removed permanently. If any tenant still is,
              it&apos;s archived instead (hidden from new signups, but existing tenants on it
              are unaffected) rather than deleted outright, since that would break their
              billing record.
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
  );
}
