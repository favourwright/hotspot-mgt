/** GET /api/v1/locations : every location, newest first. Scope locations:read. */

import { getTenantLocations } from "@/lib/firestore-helpers";
import { publicApi } from "@/lib/public-api";
import { publicLocation } from "@/lib/public-api-serializers";

export const GET = publicApi("locations:read", async ({ tenantId }) => {
  const locations = await getTenantLocations(tenantId);
  return { data: locations.map(publicLocation), reads: Math.max(1, locations.length) };
});
