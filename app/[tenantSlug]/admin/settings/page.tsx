import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenant-context";
import { formatNaira } from "@/lib/utils";
import { DEFAULT_BILLING_PLAN_CONFIG } from "@/types/schemas";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function TenantSettingsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  let tenant;
  try {
    tenant = await requireTenant(tenantSlug);
  } catch {
    notFound();
  }

  const planConfig = DEFAULT_BILLING_PLAN_CONFIG[tenant.billingPlan];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">
          Your business and billing information
        </p>
      </div>

      <Card className="p-6 space-y-4">
        <h2 className="font-semibold">Business Info</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Business Name</p>
            <p className="font-medium">{tenant.businessName}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Portal URL</p>
            <p className="font-medium font-mono">/{tenant.slug}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Status</p>
            <Badge
              variant={tenant.status === "active" ? "default" : "destructive"}
            >
              {tenant.status}
            </Badge>
          </div>
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <h2 className="font-semibold">Billing Plan</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Plan</p>
            <p className="font-medium">{planConfig.label}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Monthly Fee</p>
            <p className="font-medium">
              {planConfig.monthlyFee === 0
                ? "Free"
                : formatNaira(planConfig.monthlyFee)}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Platform Fee</p>
            <p className="font-medium">{planConfig.platformFeePercent}%</p>
          </div>
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <h2 className="font-semibold">Bank Account</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Bank</p>
            <p className="font-medium">{tenant.bankName}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Account Number</p>
            <p className="font-medium font-mono">
              ****{tenant.accountNumber?.slice(-4)}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Account Name</p>
            <p className="font-medium">{tenant.accountName}</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
