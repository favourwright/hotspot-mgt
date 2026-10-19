import { requireTenantOwner } from "@/lib/tenant-context";
import { tenantUrl } from "@/lib/tenant-url";
import { describeFeeDiscount, formatDay, formatNaira } from "@/lib/utils";
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
import { PortalSettings } from "@/components/tenant/portal-settings";
import { AccountEmailCard } from "@/components/auth/account-email-card";
import { getNotificationSettings } from "@/lib/notification-prefs";
import { getPlanFeeState } from "@/lib/fee-waivers";
import { getServerUser } from "@/lib/server-auth";
import { PlanSubscriptionActions } from "@/components/tenant/plan-subscription-actions";
import { PlanChangeDialog } from "@/components/tenant/plan-change-dialog";

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

  // Whether the plan fee is owed, waived or already being collected. Derived
  // from the clock and the tenant's waivers, so it is right the moment a
  // waiver runs out with nothing having to run.
  const planFee = await getPlanFeeState(tenant.id);

  // A superadmin viewing this page sees the state and no buttons. The API
  // behind them is owner-only regardless; this just stops offering an action
  // that would be refused.
  const viewer = await getServerUser();
  const isOwner = viewer?.role === "owner" && viewer.tenantId === tenant.id;

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

      <SurfaceCard
        // A node rather than an action spec: this slot manages its own
        // dialog, and a spec would stretch a click target over the whole
        // card and swallow everything in it.
        action={
          planFee ? (
            // Two actions, because there are two ways out of an unpaid fee
            // and offering only the first makes "pay" the sole option for a
            // tenant whose problem is that they cannot. Changing plan is
            // deliberately available in every state, not just the overdue
            // one - somebody outgrowing their tier should not have to lapse
            // first to find the control.
            <div className="flex flex-wrap gap-2">
              {isOwner && (
                <PlanChangeDialog
                  currentPlanId={tenant.planId}
                  currentPlanName={planFee.planName || tenant.planName}
                />
              )}
              <PlanSubscriptionActions
                status={planFee.status}
                monthlyFee={planFee.monthlyFee}
                planName={planFee.planName || tenant.planName}
                businessName={tenant.businessName}
                waiverEndsAt={planFee.waiverEndsAt?.toISOString() ?? null}
                discountKobo={planFee.discountKobo}
                nextBillingDate={tenant.nextBillingDate?.toISOString() ?? null}
                locked={planFee.locked}
                canManage={isOwner}
              />
            </div>
          ) : null
        }
      >
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
            {tenant.monthlyFee === 0 ? (
              "Free"
            ) : planFee?.status === "waived" ? (
              <>
                <span className="text-muted-foreground line-through">
                  {formatNaira(tenant.monthlyFee)}
                </span>{" "}
                <Badge variant="secondary">
                  {describeFeeDiscount(
                    planFee.monthlyFee,
                    planFee.discountKobo
                  ).label}
                  {planFee.waiverEndsAt
                    ? ` until ${formatDay(planFee.waiverEndsAt)}`
                    : ""}
                </Badge>
              </>
            ) : (
              formatNaira(tenant.monthlyFee)
            )}
          </Field>
          <Field label="Platform fee">{tenant.platformFeePercent}%</Field>
        </SurfaceCardContent>
      </SurfaceCard>

      {/*
        Keyed to the tenant's owner, not to whoever is looking. A superadmin
        viewing this page sees the tenant's address, read only - without the
        uid they saw their own, with working buttons, on someone else's
        settings page.
      */}
      <AccountEmailCard
        accountUid={tenant.ownerUid}
        accountEmail={tenant.ownerEmail}
        description="Sales summaries and alerts about failed sales or an offline router are sent here, and it is how you sign in."
      />

      <NotificationSettings initial={notifications} ownerUid={tenant.ownerUid} />

      {/*
        Read straight off the tenant document rather than through an endpoint
        of its own, which is also how the captive portal gets them: both
        pages already load this record, so these three fields cost nothing to
        show anywhere.
      */}
      <PortalSettings
        initial={{
          portalMacNotice: tenant.portalMacNotice,
          supportPhone: tenant.supportPhone,
          supportPhoneIsWhatsapp: tenant.supportPhoneIsWhatsapp,
        }}
        canEdit={isOwner}
      />

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
