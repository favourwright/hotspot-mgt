/**
 * The rules for `limits.maxRouters` and `limits.maxLocations`.
 *
 * Holds no Firestore import, so the admin tables can grey out their add
 * buttons with the same answer and wording the server refuses with, and
 * `npm run test:plan-limits` can run without credentials. The server half is
 * `lib/plan-resource-limit-check.ts`.
 *
 * Every document counts, active or not, the same as the usage figure
 * `lib/plan-change.ts` warns about: a deactivated router can be switched back
 * on with no create call to stop it, so it has to keep its seat. Deleting one
 * frees the seat.
 */

export type PlanResourceLimit = "maxRouters" | "maxLocations";

const NOUNS: Record<PlanResourceLimit, { one: string; many: string }> = {
  maxRouters: { one: "router", many: "routers" },
  maxLocations: { one: "location", many: "locations" },
};

/** `null` is unlimited, never zero. */
export function isAtPlanLimit(current: number, allowed: number | null): boolean {
  if (allowed === null) return false;
  return current >= allowed;
}

export function planLimitMessage(
  limit: PlanResourceLimit,
  allowed: number,
  planName?: string | null
): string {
  const { one, many } = NOUNS[limit];
  const plan = planName ? `The ${planName} plan` : "Your plan";
  const noun = allowed === 1 ? one : many;
  return `${plan} allows up to ${allowed} ${noun}. Delete a ${one} you no longer use, or move to a larger plan in Settings.`;
}
