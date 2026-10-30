/** GET /api/v1/plans/{id}. Scope plans:read. */

import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { parsePlan } from "@/lib/firestore-helpers";
import { notFound, publicApi } from "@/lib/public-api";
import { publicPlan } from "@/lib/public-api-serializers";

export const GET = publicApi<{ id: string }>("plans:read", async ({ tenantId }, { id }) => {
  const plan = parsePlan(await adminDb.collection(TENANT_COLLECTIONS.plans(tenantId)).doc(id).get());
  if (!plan) notFound("plan");
  return { data: publicPlan(plan), reads: 1 };
});
