/**
 * Runs once when the server starts (Next.js instrumentation). In development it refuses
 * to run against production data or money: lib/dev-environment-guard.ts.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { guardDevelopmentEnvironment } = await import("@/lib/dev-environment-guard");
  guardDevelopmentEnvironment();
}
