import { unstable_cache, revalidateTag } from "next/cache";
import { getTenantBySlug } from "@/lib/firestore-helpers";
import { Tenant } from "@/types/schemas";

/**
 * Every page under /[tenantSlug] resolves the slug to a tenant, so this is
 * the most frequently repeated read in the app - once per visitor per page,
 * for a record that changes maybe a few times a year.
 *
 * The TTL is deliberately short. Explicit invalidation below covers the
 * edits a person makes and expects to see immediately; the TTL is the safety
 * net, so anything that slips through is wrong for a minute at most rather
 * than until the cache is evicted.
 *
 * Note: this uses `unstable_cache`, which Next 16 marks as superseded by the
 * `use cache` directive. `use cache` needs the app-wide `cacheComponents`
 * flag, so switching is its own migration rather than part of this change.
 */
const TENANT_CACHE_SECONDS = 60;

export function tenantTag(slug: string): string {
  return `tenant:${slug}`;
}

/**
 * The cache round-trips values as JSON, which turns Dates into strings -
 * and TenantSchema declares createdAt/updatedAt/nextBillingDate as real
 * Dates, so callers would get strings that look fine until something calls
 * a Date method on them. Convert in both directions explicitly.
 */
type SerializedTenant = Omit<
  Tenant,
  "createdAt" | "updatedAt" | "nextBillingDate"
> & {
  createdAt: string;
  updatedAt: string;
  nextBillingDate: string | null;
};

function serializeTenant(tenant: Tenant): SerializedTenant {
  return {
    ...tenant,
    createdAt: tenant.createdAt.toISOString(),
    updatedAt: tenant.updatedAt.toISOString(),
    nextBillingDate: tenant.nextBillingDate
      ? tenant.nextBillingDate.toISOString()
      : null,
  };
}

function reviveTenant(tenant: SerializedTenant): Tenant {
  return {
    ...tenant,
    createdAt: new Date(tenant.createdAt),
    updatedAt: new Date(tenant.updatedAt),
    nextBillingDate: tenant.nextBillingDate
      ? new Date(tenant.nextBillingDate)
      : null,
  };
}

export async function getCachedTenantBySlug(
  slug: string
): Promise<Tenant | null> {
  const load = unstable_cache(
    async () => {
      const tenant = await getTenantBySlug(slug);
      return tenant ? serializeTenant(tenant) : null;
    },
    ["tenant-by-slug", slug],
    { tags: [tenantTag(slug)], revalidate: TENANT_CACHE_SECONDS }
  );

  const cached = await load();
  return cached ? reviveTenant(cached) : null;
}

/**
 * Call after anything that changes a tenant record. `expire: 0` means the
 * next request blocks for fresh data instead of being served the stale copy
 * - the person who just saved the change must see it.
 */
export function invalidateTenant(slug: string): void {
  revalidateTag(tenantTag(slug), { expire: 0 });
}
