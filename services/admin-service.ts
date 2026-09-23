import { apiClient } from "@/lib/api-client";
import { Location, Plan } from "@/types/schemas";

// Locations
export const locationsService = {
  getAll: async (): Promise<Location[]> => {
    const response = await apiClient.get("/api/admin/locations");
    return response.data;
  },

  create: async (data: Omit<Location, "id" | "createdAt">): Promise<Location> => {
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

  testConnection: async (
    data: Pick<Location, "routerIp" | "routerUser" | "routerPass">
  ): Promise<{ version: string; uptime: string }> => {
    const response = await apiClient.post("/api/admin/locations/test", data);
    return response.data;
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

// Vouchers
export const vouchersService = {
  retry: async (voucherId: string): Promise<void> => {
    await apiClient.post("/api/voucher/retry", { voucherId });
  },
};
