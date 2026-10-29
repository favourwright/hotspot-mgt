/**
 * Where "Verify your account" sends a customer: the start of account
 * linking (app/api/hooks/link/start), returning them to exactly this page
 * afterwards. The query string is kept on purpose: on the captive portal it
 * carries the router's session (`mac`, `link-login-only`), and losing it
 * means a voucher bought after verifying cannot be handed to the router
 * (docs/captive-portal.md).
 */
export function linkStartHref(tenantSlug: string): string {
  const here =
    typeof window === "undefined"
      ? "/"
      : `${window.location.pathname}${window.location.search}`;
  const params = new URLSearchParams({ tenant: tenantSlug, returnTo: here });
  return `/api/hooks/link/start?${params.toString()}`;
}
