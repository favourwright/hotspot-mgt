import { getTenant } from "@/lib/tenant-context";
import { getServerUser } from "@/lib/server-auth";
import { getPlanFeeState } from "@/lib/fee-waivers";
import { NoticeStack } from "@/components/system/notice-stack";
import { PlanFeeNotice } from "@/components/tenant/plan-fee-notice";
import { EmailVerificationNotice } from "@/components/auth/email-verification-notice";

/**
 * Everything standing between a tenant owner and a clean page, resolved once
 * per request and rendered above every admin route.
 *
 * ## Why this is a server component, and what that bought
 *
 * `PlanFeeNotice` needs `getPlanFeeState`, which is firebase-admin and
 * cannot run in the browser. The admin layout was `"use client"`, so the
 * notice could not be mounted there - which is the entire reason it had been
 * dropped into the dashboard page instead and was missing from every other
 * admin route, including the settings page it links to.
 *
 * The fix was to stop making the layout choose. The layout is now a server
 * component that renders this, and hands the client guard (`AdminShell`) the
 * result as a prop. The guard still decides whether anything is shown at
 * all; it just no longer has to be the thing that fetches it.
 *
 * `EmailVerificationNotice` stays a client component - it reads the live
 * Firebase user, because `emailVerified` flips without a page load and a
 * server-rendered copy would keep insisting the address is unconfirmed until
 * something else happened to re-render. A server parent rendering a client
 * child is fine; it is the other direction that is not.
 *
 * ## Owners only
 *
 * A superadmin viewing somebody else's tenant gets nothing. Their own email
 * address is not this tenant's problem, and an overdue fee is not theirs to
 * be nagged about - the superadmin billing page is where they would act on
 * it, with controls this page does not have.
 */
export async function AdminNotices({ tenantSlug }: { tenantSlug: string }) {
  const [tenant, user] = await Promise.all([
    getTenant(tenantSlug),
    getServerUser(),
  ]);

  if (!tenant || !user) return null;
  if (user.role !== "owner" || user.tenantId !== tenant.id) return null;

  const planFee = await getPlanFeeState(tenant.id);

  // Order is severity, and it is decided here rather than in NoticeStack so
  // that the stack stays a layout primitive. Money first: an overdue fee can
  // stop the business trading, an unconfirmed address cannot.
  return (
    <NoticeStack>
      <PlanFeeNotice state={planFee} tenantSlug={tenantSlug} />
      <EmailVerificationNotice audience="owner" />
    </NoticeStack>
  );
}
