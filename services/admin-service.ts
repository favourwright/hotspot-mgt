import { apiClient } from "@/lib/api-client";
import { Location, Plan, Router, MikrotikProfile } from "@/types/schemas";
import type { HotspotUsersResult } from "@/lib/hotspot-users";
import type { ActiveSession } from "@/lib/mikrotik";
import type { HotspotUserDetail } from "@/lib/hotspot-user-detail";

// Routers
export const routersService = {
  getAll: async (): Promise<Router[]> => {
    const response = await apiClient.get("/api/admin/routers");
    return response.data;
  },
};

// Locations
export const locationsService = {
  getAll: async (): Promise<Location[]> => {
    const response = await apiClient.get("/api/admin/locations");
    return response.data;
  },

  create: async (data: { name: string; routerId: string }): Promise<Location> => {
    const response = await apiClient.post("/api/admin/locations", data);
    return response.data;
  },

  update: async (id: string, data: Partial<Location>): Promise<Location> => {
    const response = await apiClient.patch(`/api/admin/locations/${id}`, data);
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/api/admin/locations/${id}`);
  },
};

// Plans
export const plansService = {
  getAll: async (locationId?: string): Promise<Plan[]> => {
    const url = locationId
      ? `/api/admin/plans?locationId=${locationId}`
      : "/api/admin/plans";
    const response = await apiClient.get(url);
    return response.data;
  },

  create: async (data: Omit<Plan, "id" | "createdAt">): Promise<Plan> => {
    const response = await apiClient.post("/api/admin/plans", data);
    return response.data;
  },

  update: async (id: string, data: Partial<Plan>): Promise<Plan> => {
    const response = await apiClient.patch(`/api/admin/plans/${id}`, data);
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/api/admin/plans/${id}`);
  },
};

// Stats
export interface AdminStats {
  totalRevenue: number;
  totalVouchers: number;
  activeVouchers: number;
  failedVouchers: number;
  todayVouchers: number;
  todayRevenue: number;
  /** Setup progress - drives the dashboard's next-step action. */
  routerCount: number;
  locationCount: number;
  planCount: number;
}

export const statsService = {
  get: async (): Promise<AdminStats> => {
    const response = await apiClient.get("/api/admin/stats");
    return response.data;
  },
};

// Profiles
export const profilesService = {
  getAll: async (locationId: string): Promise<MikrotikProfile[]> => {
    const response = await apiClient.get(`/api/admin/locations/${locationId}/profiles`);
    return response.data;
  },

  create: async (
    locationId: string,
    data: {
      name: string;
      rateLimit?: string;
      keepaliveTimeout?: string;
      sharedUsers?: string;
    }
  ): Promise<MikrotikProfile> => {
    const response = await apiClient.post(
      `/api/admin/locations/${locationId}/profiles`,
      data
    );
    return response.data;
  },
};

// Vouchers
//
// No `getAll` here any more. It fetched a tenant's whole voucher collection
// as one array, which is the read the paged lists exist to remove - the
// voucher pages talk to /api/admin/vouchers directly, a page at a time.
export const vouchersService = {
  retry: async (voucherId: string): Promise<void> => {
    await apiClient.post("/api/voucher/retry", { voucherId });
  },
};

export interface ActiveSessionsResult {
  sessions: ActiveSession[];
  reachable: boolean;
  error: string | null;
  routerName: string;
  locationName: string;
  fetchedAt: string;
}

// Hotspot users - the router's own view, joined with platform vouchers.
export const hotspotService = {
  getUsers: async (locationId: string): Promise<HotspotUsersResult> => {
    const response = await apiClient.get(
      `/api/admin/locations/${locationId}/hotspot-users`
    );
    return response.data;
  },

  getUserDetail: async (
    locationId: string,
    username: string
  ): Promise<HotspotUserDetail> => {
    const response = await apiClient.get(
      `/api/admin/locations/${locationId}/hotspot-users/${encodeURIComponent(username)}`
    );
    return response.data;
  },

  getActiveSessions: async (locationId: string): Promise<ActiveSessionsResult> => {
    const response = await apiClient.get(
      `/api/admin/locations/${locationId}/active-sessions`
    );
    return response.data;
  },

  /**
   * Removes a user from the router. Without `force` the server answers 409
   * and names what makes it dangerous (a live voucher, a connected device);
   * those reasons are what the confirmation shows, so it describes the real
   * situation rather than a generic warning.
   */
  deleteUser: async (
    locationId: string,
    username: string,
    force = false
  ): Promise<{ username: string; forced: boolean }> => {
    const response = await apiClient.delete(
      `/api/admin/locations/${locationId}/hotspot-users/${encodeURIComponent(username)}${force ? "?force=true" : ""}`
    );
    return response.data;
  },

  /** Hides a voucher the router will never have a match for, reversibly. */
  setVoucherArchived: async (
    voucherId: string,
    archived: boolean
  ): Promise<{ archived: boolean }> => {
    const response = await apiClient.post(
      `/api/admin/vouchers/${voucherId}/archive`,
      { archived }
    );
    return response.data;
  },

  /** Re-creates a sold voucher's user on the router. */
  recreateUser: async (voucherId: string): Promise<unknown> => {
    const response = await apiClient.post("/api/voucher/retry", { voucherId });
    return response.data;
  },
};
