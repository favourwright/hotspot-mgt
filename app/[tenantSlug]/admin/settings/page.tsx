import { requireTenantOwner } from "@/lib/tenant-context";
import { tenantUrl } from "@/lib/tenant-url";
import { formatNaira } from "@/lib/utils";
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card";
import { PageHeader } from "@/components/system/page-header";
import { MaskedValue } from "@/components/system/masked-value";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/shared/copy-button";
import { NotificationSettings } from "@/components/tenant/notification-settings";
import { AccountEmailCard } from "@/components/auth/account-email-card";
import { getNotificationSettings } from "@/lib/notification-prefs";

/** A label over its value - the unit every panel on this page is built from. */
function Field({
  label,
  children,
  mono,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className={mono ? "font-mono font-medium" : "font-medium"}>
        {children}
      </div>
    </div>
  );
}

export default async function TenantSettingsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const tenant = await requireTenantOwner(tenantSlug);

  // Read here rather than in the client component so the switches render in
  // their real positions on first paint - a toggle that flicks from on to off
  // after a fetch reads as the page undoing the owner's last change.
  const notifications = await getNotificationSettings(tenant.id);

  // Same shape as the onboarding completion screen, so the link an owner
  // copies here is byte-identical to the one they were first given.
  const portalUrl = tenantUrl(tenant.slug);

  // Pricing shown here is the tenant's own snapshotted fields (locked in at
  // signup), not a live lookup against the current plan definition - editing
  // a plan later must never retroactively change an existing tenant's price.

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Your business and billing information"
      />

      <SurfaceCard>
        <SurfaceCardHeader>
          <SurfaceCardTitle>Business info</SurfaceCardTitle>
        </SurfaceCardHeader>
        <SurfaceCardContent className="space-y-4 text-sm">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Business name">{tenant.businessName}</Field>
            <Field label="Status">
              <Badge
                variant={tenant.status === "active" ? "default" : "destructive"}
              >
                {tenant.status}
              </Badge>
            </Field>
          </div>
          {/* Full width: a complete URL doesn't fit a third of the row. */}
          <Field label="Portal URL">
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate font-mono text-sm">
                {portalUrl}
              </code>
              <CopyButton value={portalUrl} />
            </div>
          </Field>
        </SurfaceCardContent>
      </SurfaceCard>

      <SurfaceCard>
        <SurfaceCardHeader>
          <SurfaceCardTitle>Billing plan</SurfaceCardTitle>
        </SurfaceCardHeader>
        <SurfaceCardContent className="grid gap-4 text-sm sm:grid-cols-3">
          <Field label="Plan">
            {tenant.planName || (
              <span className="text-muted-foreground">Not set</span>
            )}
          </Field>
          <Field label="Monthly fee">
            {tenant.monthlyFee === 0 ? "Free" : formatNaira(tenant.monthlyFee)}
          </Field>
          <Field label="Platform fee">{tenant.platformFeePercent}%</Field>
        </SurfaceCardContent>
      </SurfaceCard>

      <AccountEmailCard description="Sales summaries and alerts about failed sales or an offline router are sent here, and it is how you sign in." />

      <NotificationSettings initial={notifications} />

      <SurfaceCard>
        <SurfaceCardHeader>
          <SurfaceCardTitle>Bank account</SurfaceCardTitle>
        </SurfaceCardHeader>
        <SurfaceCardContent className="grid gap-4 text-sm sm:grid-cols-3">
          <Field label="Bank">{tenant.bankName}</Field>
          <Field label="Account number" mono>
            {tenant.accountNumber ? (
              <MaskedValue value={tenant.accountNumber} />
            ) : (
              <span className="text-muted-foreground">Not set</span>
            )}
          </Field>
          <Field label="Account name">{tenant.accountName}</Field>
        </SurfaceCardContent>
      </SurfaceCard>
    </div>
  );
}
