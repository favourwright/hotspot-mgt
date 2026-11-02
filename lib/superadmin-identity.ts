/**
 * Whether a verified ID token is the designated superadmin.
 *
 * Pure, and takes the token rather than anything a request body said, because
 * that is the whole point of it: `/api/auth/register` used to compare
 * SUPERADMIN_EMAIL against an `email` field in the JSON body, checking only
 * `uid` against the token, so any signed-in account could post the address
 * and be granted real superadmin claims. The address is not a secret and must
 * never act like one. Only Firebase can say what address an account has.
 *
 * Two answers, because they guard different things:
 *
 *  - `designated`: this account holds the address. Enough to keep a role the
 *    document already records, since /users/{uid} cannot be written from a
 *    client. Requiring more here would refuse to re-sync the real superadmin.
 *  - `mayElevate`: enough to grant the role to an account that lacks it, which
 *    also takes a confirmed address. If SUPERADMIN_EMAIL ever names an address
 *    with no account (it has, docs/auth-and-security.md), anyone could register
 *    that address, and Firebase does not require them to control it.
 */
export interface SuperadminIdentity {
  designated: boolean;
  mayElevate: boolean;
}

export function superadminIdentity(
  token: { email?: unknown; email_verified?: unknown },
  configuredAddress: string | undefined
): SuperadminIdentity {
  const configured = (configuredAddress ?? "").trim().toLowerCase();
  const email = typeof token.email === "string" ? token.email.trim().toLowerCase() : "";

  const designated = Boolean(configured) && email === configured;
  return { designated, mayElevate: designated && token.email_verified === true };
}
