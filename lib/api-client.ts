import axios from "axios";
import { auth } from "./firebase";

// Create axios instance
export const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
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
 * allowed to view a tenant's admin pages — without this they could load a
 * page and then have every request from it rejected.
 *
 * This is a hint, not a grant: the server re-checks that the caller may act
 * on this tenant (lib/auth-helpers.ts, verifyTenantAccessBySlug).
 */
export const TENANT_SLUG_HEADER = "x-tenant-slug";

function currentTenantSlug(): string | null {
  if (typeof window === "undefined") return null;
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
      return Promise.reject(new Error(message));
    } else if (error.request) {
      // Request made but no response
      return Promise.reject(new Error("No response from server"));
    } else {
      // Something else happened
      return Promise.reject(error);
    }
  }
);
