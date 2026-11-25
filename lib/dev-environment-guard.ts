/**
 * Development must not run against production.
 *
 * `npm run dev` used to share the live Firebase project and live payment keys, so
 * "testing locally" meant testing on live data and live money. This refuses to start a
 * development server that points at any of them: the production Firebase project, live
 * Paystack keys, a live Knomad Pay key or Knomad Pay's production address. Local work
 * uses a development Firebase project and Knomad Pay staging (Monnify sandbox) instead.
 *
 * Maintenance scripts are unaffected: they read `.env.production` on purpose
 * (scripts/load-env.mts) and do not start this server. DEV_ALLOW_PRODUCTION=1 overrides
 * the check, loudly, for the rare case that really needs it.
 */

/** The live Firebase project. */
export const PRODUCTION_FIREBASE_PROJECT = "hotspot-mgt";
export const PRODUCTION_KNOMAD_PAY_URL = "https://pay.knomadhq.com";

export function productionTouchpoints(env: Record<string, string | undefined>): string[] {
  const problems: string[] = [];
  for (const key of ["NEXT_PUBLIC_FIREBASE_PROJECT_ID", "FIREBASE_ADMIN_PROJECT_ID"]) {
    if (env[key]?.trim() === PRODUCTION_FIREBASE_PROJECT) problems.push(`${key} is the production Firebase project`);
  }
  if (env.PAYSTACK_SECRET_KEY?.trim().startsWith("sk_live_")) problems.push("PAYSTACK_SECRET_KEY is a live key");
  if (env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY?.trim().startsWith("pk_live_")) problems.push("NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY is a live key");
  if (env.KNOMAD_PAY_API_KEY?.trim().startsWith("kp_live_")) problems.push("KNOMAD_PAY_API_KEY is a live key");
  if (env.KNOMAD_PAY_URL?.trim().replace(/\/+$/, "") === PRODUCTION_KNOMAD_PAY_URL) problems.push("KNOMAD_PAY_URL is Knomad Pay production");
  return problems;
}

/** Throws in development when the environment reaches production, unless overridden. */
export function guardDevelopmentEnvironment(env: Record<string, string | undefined> = process.env): void {
  if (env.NODE_ENV === "production") return;
  const problems = productionTouchpoints(env);
  if (problems.length === 0) return;
  if (env.DEV_ALLOW_PRODUCTION === "1") {
    console.warn(`\n!!! DEVELOPMENT IS RUNNING AGAINST PRODUCTION (DEV_ALLOW_PRODUCTION=1):\n  - ${problems.join("\n  - ")}\n`);
    return;
  }
  throw new Error(
    `Development will not start against production:\n  - ${problems.join("\n  - ")}\n` +
      "Point .env.development.local at the development Firebase project and Knomad Pay staging " +
      "(docs/local-setup.md), or set DEV_ALLOW_PRODUCTION=1 if you truly mean it."
  );
}
