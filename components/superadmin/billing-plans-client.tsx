"use client";

import { useState } from "react";
import { BillingPlan } from "@/types/schemas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
  const [archiveTarget, setArchiveTarget] = useState<BillingPlan | null>(null);
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

  const handleConfirmArchive = async () => {
    if (!archiveTarget) return;
    const plan = archiveTarget;
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

      setPlans((prev) =>
        prev.map((p) =>
          p.id === plan.id ? { ...p, active: false, archivedAt: new Date() } : p
        )
      );
      toast.add({ title: "Billing plan archived", type: "success" });
    } catch (err) {
      toast.add({
        title: "Failed to archive plan",
        description: err instanceof Error ? err.message : "Unknown error",
        type: "error",
      });
    } finally {
      setLoadingId(null);
      setArchiveTarget(null);
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

      <Card>
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
                            onClick={() => setArchiveTarget(plan)}
                          >
                            Archive
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => handleRestore(plan)}>
                            Restore
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <BillingPlanDialog
        mode={dialogMode}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={handleSaved}
        plan={editingPlan}
      />

      <AlertDialog
        open={archiveTarget !== null}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive Billing Plan</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to archive &quot;{archiveTarget?.name}&quot;? It will no
              longer be selectable by new tenants, but existing tenants on this plan are
              unaffected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loadingId === archiveTarget?.id}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmArchive}
              disabled={loadingId === archiveTarget?.id}
              variant="destructive"
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
