import { z } from "zod";
import { getTenantPlans } from "@/lib/firestore-helpers";
import { publicApi } from "@/lib/public-api";
import { publicPlan } from "@/lib/public-api-serializers";
import { PublicPlanSchema } from "@/lib/api-schemas";

export const GET = publicApi(
  {
    scope: "plans:read",
    summary: "List plans",
    description: "Every plan, newest first. Not paged: a business has a handful.",
    query: z.object({
      locationId: z.string().optional().describe("Only plans sold at this location"),
    }),
    response: z.array(PublicPlanSchema),
    maxReads: () => 200,
  },
  async ({ tenantId, query }) => {
    const plans = await getTenantPlans(tenantId, query.locationId);
    return { data: plans.map(publicPlan), reads: Math.max(1, plans.length) };
  }
);
