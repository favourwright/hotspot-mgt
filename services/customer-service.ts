import { apiClient } from "@/lib/api-client";
import { Plan, Location, Voucher } from "@/types";

// Public plans and locations (no auth required)
export const customerService = {
  getActivePlans: async (): Promise<Plan[]> => {
    const response = await apiClient.get("/api/plans");
    return response.data;
  },

  getActiveLocations: async (): Promise<Location[]> => {
    const response = await apiClient.get("/api/locations");
    return response.data;
  },

  getMyVouchers: async (): Promise<Voucher[]> => {
    const response = await apiClient.get("/api/vouchers");
    return response.data;
  },
};
