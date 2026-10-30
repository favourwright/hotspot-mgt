import { z } from "zod";
import { getTenantLocations } from "@/lib/firestore-helpers";
import { publicApi } from "@/lib/public-api";
import { publicLocation } from "@/lib/public-api-serializers";
import { PublicLocationSchema } from "@/lib/api-schemas";

export const GET = publicApi(
  {
    scope: "locations:read",
    summary: "List locations",
    description: "Every location, newest first. Not paged.",
    response: z.array(PublicLocationSchema),
    maxReads: () => 200,
  },
  async ({ tenantId }) => {
    const locations = await getTenantLocations(tenantId);
    return { data: locations.map(publicLocation), reads: Math.max(1, locations.length) };
  }
);
