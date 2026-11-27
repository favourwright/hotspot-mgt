import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api-client";
import { routersService } from "@/services/admin-service";
import { Router } from "@/types/schemas";

export const ROUTERS_QUERY_KEY = ["routers"];

export function useRouters(initialData?: Router[]) {
  return useQuery({
    queryKey: ROUTERS_QUERY_KEY,
    queryFn: routersService.getAll,
    initialData,
  });
}

interface CreateRouterInput {
  name: string;
  connectionMethod: "wireguard" | "direct";
  routerIp: string;
  routerUser: string;
  routerPass: string;
  wireguardPublicKey?: string;
  wireguardTunnelIp?: string;
  wireguardInterfaceName?: string;
  wireguardListenPort?: number;
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
  const queryClient = useQueryClient();
  // Re-renders the admin layout, whose nav and router notice read the
  // tenant's routers and locations (lib/tenant-fleet.ts).
  const navigation = useRouter();

  return useMutation({
    mutationFn: async (data: CreateRouterInput): Promise<Router> => {
      const response = await apiClient.post("/api/admin/routers", data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ROUTERS_QUERY_KEY });
      navigation.refresh();
    },
  });
}

export function useUpdateRouter() {
  const queryClient = useQueryClient();
  // Re-renders the admin layout, whose nav and router notice read the
  // tenant's routers and locations (lib/tenant-fleet.ts).
  const navigation = useRouter();

  return useMutation({
    mutationFn: async ({ id, ...data }: UpdateRouterInput): Promise<Router> => {
      const response = await apiClient.patch(`/api/admin/routers/${id}`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ROUTERS_QUERY_KEY });
      navigation.refresh();
    },
  });
}

export function useDeleteRouter() {
  const queryClient = useQueryClient();
  // Re-renders the admin layout, whose nav and router notice read the
  // tenant's routers and locations (lib/tenant-fleet.ts).
  const navigation = useRouter();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await apiClient.delete(`/api/admin/routers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ROUTERS_QUERY_KEY });
      navigation.refresh();
    },
  });
}
