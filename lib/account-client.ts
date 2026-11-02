import type { UserRole } from "@/lib/auth-claims";

/**
 * What the browser may know about the signed-in account, from /api/auth/me.
 * The whole of what any client code reads off a tenant.
 */
export interface TenantSummary {
  id: string;
  slug: string;
  businessName: string;
  monthlyFee: number | null;
}

export interface AccountSummary {
  role: UserRole;
  tenantId: string | null;
  tenant: TenantSummary | null;
}

/**
 * Asks the server who this token belongs to. `null` means the account does not
 * exist yet, a normal answer mid-registration. Throws on anything else, so that
 * callers cannot read an outage as "this person has no role".
 */
export async function fetchAccountSummary(
  idToken: string
): Promise<AccountSummary | null> {
  const response = await fetch("/api/auth/me", {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!response.ok) {
    throw new Error(`Account lookup failed with HTTP ${response.status}`);
  }
  const body = await response.json();
  return body.data ?? null;
}
