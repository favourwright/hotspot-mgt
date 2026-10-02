/**
 * Notification stubs — no real email infrastructure exists yet. Each
 * function is a single, clearly-marked seam: wire up real email here later
 * (e.g. Resend/SendGrid) without needing to touch any of the enforcement
 * logic that calls these.
 */

export type PlanLimitType = "maxCustomers" | "maxLocations" | "maxRouters";

export async function notifyLimitReached(
  tenantId: string,
  limitType: PlanLimitType
): Promise<void> {
  // TODO: wire up real email once email infrastructure exists.
  console.log(
    `[notification stub] Tenant ${tenantId} reached their ${limitType} limit.`
  );
}
