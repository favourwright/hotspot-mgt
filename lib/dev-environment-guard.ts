/**
 * Development must not move live money.
 *
 * Local development runs against the live Firebase project, by choice (there is no
 * separate one), so test purchases belong to a test tenant. What it must never touch is
 * live payment credentials: a development server refuses to start with a live Knomad
 * Pay key or Knomad Pay's production address. Local payments go
 * through Knomad Pay staging, on Monnify's sandbox.
 *
 * Maintenance scripts are unaffected: they read `.env.production` on purpose
 * (scripts/load-env.mts) and do not start this server. DEV_ALLOW_PRODUCTION=1 overrides
 * the check, loudly, for the rare case that really needs it.
 */

export const PRODUCTION_KNOMAD_PAY_URL = "https://pay.knomadhq.com";

export function productionTouchpoints(env: Record<string, string | undefined>): string[] {
  const problems: string[] = [];
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
    `Development will not start with live payment credentials:\n  - ${problems.join("\n  - ")}\n` +
      "Use test keys and Knomad Pay staging in .env.development.local (docs/local-setup.md), " +
      "or set DEV_ALLOW_PRODUCTION=1 if you truly mean it."
  );
}
