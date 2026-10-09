import axios from "axios";
import { auth } from "./firebase";
import { appRootDomain, tenantSlugFromHost } from "./app-host";

// Create axios instance
export const apiClient = axios.create({
  // Relative in the browser, so every request goes to the host the page is
  // already on. `/api` is host-neutral in proxy.ts, so the same route
  // answers on the apex and on every tenant subdomain.
  //
  // A fixed absolute base was the original form and broke the moment
  // tenants moved to subdomains: a call from starlink.ogawifi.online to
  // ogawifi.online is cross-origin, so the browser sends a CORS preflight
  // that nothing answers, and every admin query fails before it is sent.
  baseURL:
    typeof window === "undefined"
      ? process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
      : "",
  headers: {
    "Content-Type": "application/json",
  },
});

/**
 * The tenant whose admin pages the browser is currently on, taken from the
 * URL (/{slug}/admin/...).
 *
 * An owner's requests are scoped by their own account server-side, so this
 * changes nothing for them. A superadmin has no tenant of their own, yet is
 * allowed to view a tenant's admin pages - without this they could load a
 * page and then have every request from it rejected.
 *
 * This is a hint, not a grant: the server re-checks that the caller may act
 * on this tenant (lib/auth-helpers.ts, verifyTenantAccessBySlug).
 */
export const TENANT_SLUG_HEADER = "x-tenant-slug";

function currentTenantSlug(): string | null {
  if (typeof window === "undefined") return null;

  // On a subdomain deployment the slug is the host label and the path no
  // longer carries it at all -- an admin page is at `/admin/locations`, not
  // `/starlink/admin/locations`, so the path pattern below never matches
  // there and a superadmin viewing a tenant would send no slug at all.
  if (appRootDomain()) {
    const fromHost = tenantSlugFromHost(window.location.host);
    if (fromHost) return fromHost;
  }

  const match = window.location.pathname.match(/^\/([^/]+)\/admin(?:\/|$)/);
  return match ? match[1] : null;
}

// Request interceptor to add auth token
apiClient.interceptors.request.use(
  async (config) => {
    if (auth?.currentUser) {
      const token = await auth.currentUser.getIdToken();
      config.headers.Authorization = `Bearer ${token}`;
    }

    const slug = currentTenantSlug();
    if (slug) {
      config.headers[TENANT_SLUG_HEADER] = slug;
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response) {
      // Server responded with error
      const message = error.response.data?.error || error.response.data?.message || "An error occurred";
      // Carry the status and payload along. Some refusals are not just a
      // message -- a 409 from the hotspot-user delete names exactly what
      // makes it dangerous, and the confirmation dialog shows those reasons
      // rather than inventing a generic warning.
      return Promise.reject(
        Object.assign(new Error(message), {
          status: error.response.status as number,
          data: error.response.data?.data,
        })
      );
    } else if (error.request) {
      // Request made but no response
      return Promise.reject(new Error("No response from server"));
    } else {
      // Something else happened
      return Promise.reject(error);
    }
  }
);

/**
 * The status and payload an API refusal carried, when it had them.
 * `instanceof Error` stays true; these are extra fields the response
 * interceptor attaches.
 */
export interface ApiError extends Error {
  status?: number;
  data?: unknown;
}

/** Narrowing helper for a refusal that listed its reasons (HTTP 409). */
export function blockersFrom(error: unknown): string[] | null {
  if (!(error instanceof Error)) return null;
  const data = (error as ApiError).data;
  if (data && typeof data === "object" && Array.isArray((data as { blockers?: unknown }).blockers)) {
    return (data as { blockers: string[] }).blockers;
  }
  return null;
}
