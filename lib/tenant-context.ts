import { cache } from "react";
import { getTenantBySlug } from "@/lib/firestore-helpers";
import { Tenant } from "@/types/schemas";

/**
 * Cached tenant resolver for server components.
 * React cache() deduplicates calls within a single
 * request — same slug is only fetched once.
 */
export const getTenant = cache(
  async (slug: string): Promise<Tenant | null> => {
    return getTenantBySlug(slug);
  }
);

/**
 * Resolve tenant or throw a structured error.
 * Used in server components that require a valid tenant.
 */
export async function requireTenant(slug: string): Promise<Tenant> {
  const tenant = await getTenant(slug);

  if (!tenant) {
    throw new Error(`Tenant not found: ${slug}`);
  }

  if (tenant.status === "suspended") {
    throw new Error(`Tenant suspended: ${slug}`);
  }

  return tenant;
}
