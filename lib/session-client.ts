/**
 * Mints the server-readable httpOnly session cookie right after Firebase
 * client-side sign-in/sign-up. Without this, server components have no way
 * to know who's asking — see lib/server-auth.ts.
 */
export async function establishSession(idToken: string): Promise<void> {
  try {
    await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
  } catch (error) {
    console.error("Failed to establish server session:", error);
  }
}

export async function clearSession(): Promise<void> {
  try {
    await fetch("/api/auth/session", { method: "DELETE" });
  } catch (error) {
    console.error("Failed to clear server session:", error);
  }
}
