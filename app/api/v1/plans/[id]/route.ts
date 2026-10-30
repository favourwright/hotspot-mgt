import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { parsePlan } from "@/lib/firestore-helpers";
import { notFound, publicApi } from "@/lib/public-api";
import { publicPlan } from "@/lib/public-api-serializers";
import { PublicPlanSchema } from "@/lib/api-schemas";

export const GET = publicApi(
  { scope: "plans:read", summary: "Get a plan", response: PublicPlanSchema },
  async ({ tenantId }, { id }: { id: string }) => {
    const plan = parsePlan(await adminDb.collection(TENANT_COLLECTIONS.plans(tenantId)).doc(id).get());
    if (!plan) notFound("plan");
    return { data: publicPlan(plan), reads: 1 };
  }
);
