import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

import { resolveOwnerTenantSlug } from "@/lib/owner-redirect";
import { pushTenantUrl, tenantHref } from "@/lib/tenant-url";

/**
 * Where a signed-in person belongs, in one place.
 *
 * Two callers need this answer and they must not drift: the sign-in form,
 * once a sign-in succeeds, and the gate on `/auth` that bounces somebody
 * who is already signed in. "Send them where logging in would have sent
 * them" is only true if both ask the same function.
 *
 * ## The destinations
 *
 * - **superadmin** goes to the platform dashboard.
 * - **owner** goes to their own tenant's admin area, on that tenant's
 *   subdomain. Falls back to `/` when the slug cannot be resolved, which
 *   is a real case: a signed-in owner whose tenant document is missing
 *   should land somewhere, not nowhere.
 * - **customer** goes to `/`, and that is host-aware rather than lazy.
 *   On a tenant subdomain `/` is that venue's storefront, which is the
 *   list of plans they can buy. On the apex there is no plans list to
 *   show, because a customer is not bound to any one business, so the
 *   landing page is the honest answer.
 *
 * ## Why neither caller is allowed to honour a return URL here
 *
 * A `?redirect=` or `?next=` carried into the *gate* is how a redirect
 * loop gets built: the gate fires on arrival, so sending somebody back to
 * a page that bounces their role lands them on `/auth` again, which fires
 * the gate again. A role destination cannot do that, because by
 * construction it is a page that role can render.
 *
 * The sign-in form is different and may keep honouring `next`: it runs
 * once, after a deliberate action, and if its destination bounces the
 * user they arrive at `/auth` and the gate then resolves them terminally.
 *
 * The wider invariant worth preserving: **every redirect into `/auth` in
 * this codebase is gated on there being no user.** The gate only fires
 * when there is one. Two conditions that cannot both hold cannot
 * alternate, which is what makes the whole arrangement loop-free. If you
 * ever add a redirect to `/auth` for a signed-in user, that stops being
 * true.
 */
export type AuthedRole = "superadmin" | "owner" | "customer";

/**
 * The destination as an href, when it can be known without a read.
 *
 * For rendering a link rather than navigating - a nav bar cannot await.
 * Returns `null` for an owner whose slug has not loaded yet, because the
 * honest options there are "wait" or "guess", and a nav item pointing at
 * the wrong tenant is worse than one that appears a moment late.
 */
export function postLoginHref(
  role: AuthedRole | null,
  tenantSlug: string | null | undefined
): string | null {
  if (role === "superadmin") return "/superadmin";
  if (role === "owner") return tenantSlug ? tenantHref(tenantSlug, "/admin") : null;
  return "/";
}

/**
 * Navigate to the destination, resolving an owner's slug if needed.
 *
 * `replace` for the gate, so the page somebody was bounced off does not
 * sit in their history waiting for the Back button.
 */
export async function goToPostLoginDestination(
  router: AppRouterInstance,
  {
    role,
    tenantSlug = null,
    replace = false,
  }: {
    role: AuthedRole | null;
    /** Already known, e.g. from the auth store. Skips the lookup. */
    tenantSlug?: string | null;
    replace?: boolean;
  }
): Promise<void> {
  const go = (path: string) =>
    replace ? router.replace(path) : router.push(path);

  if (role === "superadmin") {
    go("/superadmin");
    return;
  }

  if (role === "owner") {
    const slug = tenantSlug ?? (await resolveOwnerTenantSlug());
    if (slug) {
      pushTenantUrl(router, slug, "/admin", { replace });
      return;
    }
    go("/");
    return;
  }

  go("/");
}
