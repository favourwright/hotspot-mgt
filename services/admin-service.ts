import { apiClient } from "@/lib/api-client";
import { Location, Plan, MikrotikProfile } from "@/types/schemas";

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
  todayPayments: number;
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
      sessionTimeout?: string;
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
export const vouchersService = {
  retry: async (voucherId: string): Promise<void> => {
    await apiClient.post("/api/voucher/retry", { voucherId });
  },
};
