import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { getTenantBySlug } from "@/lib/firestore-helpers";
import { getServerUser } from "@/lib/server-auth";
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

/**
 * Resolve tenant AND verify the caller is allowed to see its admin data —
 * the owner of this tenant, or a superadmin (view-only). This is the only
 * gate for every /{tenantSlug}/admin/* page: it must run, and redirect/404,
 * BEFORE any tenant data is fetched — the client-side layout guard only
 * hides the UI, it can't stop data already sent in the server render.
 */
export async function requireTenantOwner(slug: string): Promise<Tenant> {
  const tenant = await getTenant(slug);
  if (!tenant || tenant.status === "suspended") {
    notFound();
  }

  const serverUser = await getServerUser();
  if (!serverUser) {
    redirect(`/auth?redirect=/${slug}/admin`);
  }

  const isSuperAdmin = serverUser.role === "superadmin";
  const isOwner = serverUser.role === "owner" && serverUser.tenantId === tenant.id;

  if (!isSuperAdmin && !isOwner) {
    redirect(`/${slug}`);
  }

  return tenant;
}
