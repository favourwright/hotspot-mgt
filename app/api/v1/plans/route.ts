/** GET /api/v1/plans?locationId= : every plan, newest first. Scope plans:read. */

import { getTenantPlans } from "@/lib/firestore-helpers";
import { publicApi } from "@/lib/public-api";
import { publicPlan } from "@/lib/public-api-serializers";

export const GET = publicApi("plans:read", async ({ tenantId, url }) => {
  const locationId = url.searchParams.get("locationId") || undefined;
  const plans = await getTenantPlans(tenantId, locationId);
  return { data: plans.map(publicPlan), reads: Math.max(1, plans.length) };
});
