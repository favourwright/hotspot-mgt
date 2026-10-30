/** GET /api/v1/customers/{uid}, with the tenant's own `externalId` if linked. Scope customers:read. */

import { getTenantCustomer } from "@/lib/firestore-helpers";
import { getExternalId } from "@/lib/hook-links";
import { notFound, publicApi } from "@/lib/public-api";
import { publicCustomer } from "@/lib/public-api-serializers";

export const GET = publicApi<{ uid: string }>(
  "customers:read",
  async ({ tenantId }, { uid }) => {
    const customer = await getTenantCustomer(tenantId, uid);
    if (!customer) notFound("customer");
    return { data: publicCustomer(customer, await getExternalId(tenantId, uid)), reads: 2 };
  },
  () => 2
);
