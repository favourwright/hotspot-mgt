import Link from "next/link";
import { WifiOff } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { tenantHref } from "@/lib/tenant-url";
import type { TenantFleet } from "@/lib/tenant-fleet";

/**
 * Says, on every admin page, that a router is not answering.
 *
 * This is what lets Routers leave the main nav once setup is done
 * (`components/tenant/admin-nav.tsx`): after setup, the one reason an owner
 * goes looking for that page is that something is wrong with a router, so
 * that has to come and find them instead. The `router-health` email is
 * still the first channel; this is for the owner already in the app, and it
 * stays up for as long as the router is down rather than arriving once.
 *
 * Status comes from `router-health`, every 15 minutes, so this can lag a
 * real outage or recovery by up to that. The job clears the cache on every
 * transition, so the lag is the job's, never the cache's.
 */
export function RouterOfflineNotice({
  routers,
  tenantSlug,
}: {
  routers: TenantFleet["offlineRouters"];
  tenantSlug: string;
}) {
  if (routers.length === 0) return null;

  const named =
    routers.length === 1
      ? `${routers[0].name} is offline`
      : `${routers.length} routers are offline (${routers.map((r) => r.name).join(", ")})`;

  return (
    <Alert variant="destructive">
      <WifiOff className="h-4 w-4" />
      <AlertDescription>
        {named}.{" "}
        {routers.length === 1
          ? "Customers at that location cannot connect until it is back."
          : "Customers at those locations cannot connect until they are back."}{" "}
        <Link href={tenantHref(tenantSlug, "/admin/routers")} className="underline">
          View routers
        </Link>
      </AlertDescription>
    </Alert>
  );
}
