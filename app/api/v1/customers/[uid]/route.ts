import { getTenantCustomer } from "@/lib/firestore-helpers";
import { getExternalId } from "@/lib/hook-links";
import { notFound, publicApi } from "@/lib/public-api";
import { publicCustomer } from "@/lib/public-api-serializers";
import { PublicCustomerSchema } from "@/lib/api-schemas";

export const GET = publicApi(
  {
    scope: "customers:read",
    summary: "Get a customer",
    description: "Includes `externalId`, the business's own id for them, once linked through a decision hook.",
    response: PublicCustomerSchema,
  },
  async ({ tenantId }, { uid }: { uid: string }) => {
    const customer = await getTenantCustomer(tenantId, uid);
    if (!customer) notFound("customer");
    return { data: publicCustomer(customer, await getExternalId(tenantId, uid)), reads: 2 };
  }
);
