import { useMutation } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Router } from "@/types/schemas";

interface CreateRouterInput {
  name: string;
  connectionMethod: "wireguard" | "direct";
  routerIp: string;
  routerUser: string;
  routerPass: string;
  wireguardPublicKey?: string;
  wireguardTunnelIp?: string;
  status: "pending" | "online" | "offline";
}

interface UpdateRouterInput {
  id: string;
  name?: string;
  routerIp?: string;
  routerUser?: string;
  routerPass?: string;
  active?: boolean;
  status?: "pending" | "online" | "offline";
}

export function useCreateRouter() {
  return useMutation({
    mutationFn: async (data: CreateRouterInput): Promise<Router> => {
      const response = await apiClient.post("/api/admin/routers", data);
      return response.data;
    },
  });
}

export function useUpdateRouter() {
  return useMutation({
    mutationFn: async ({ id, ...data }: UpdateRouterInput): Promise<Router> => {
      const response = await apiClient.patch(`/api/admin/routers/${id}`, data);
      return response.data;
    },
  });
}

export function useDeleteRouter() {
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await apiClient.delete(`/api/admin/routers/${id}`);
    },
  });
}
