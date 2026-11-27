import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { locationsService } from "@/services/admin-service";
import { Location } from "@/types/schemas";

export const LOCATIONS_QUERY_KEY = ["locations"];

export function useLocations(initialData?: Location[]) {
  return useQuery({
    queryKey: LOCATIONS_QUERY_KEY,
    queryFn: locationsService.getAll,
    initialData,
  });
}

export function useCreateLocation() {
  const queryClient = useQueryClient();
  // Re-renders the admin layout, whose nav and router notice read the
  // tenant's routers and locations (lib/tenant-fleet.ts).
  const navigation = useRouter();

  return useMutation({
    mutationFn: (data: { name: string; routerId: string }) =>
      locationsService.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: LOCATIONS_QUERY_KEY });
      navigation.refresh();
    },
  });
}

export function useUpdateLocation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Location> }) =>
      locationsService.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: LOCATIONS_QUERY_KEY });
    },
  });
}

export function useDeleteLocation() {
  const queryClient = useQueryClient();
  // Re-renders the admin layout, whose nav and router notice read the
  // tenant's routers and locations (lib/tenant-fleet.ts).
  const navigation = useRouter();

  return useMutation({
    mutationFn: locationsService.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: LOCATIONS_QUERY_KEY });
      navigation.refresh();
    },
  });
}

// Toggle location active status
export function useToggleLocation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      locationsService.update(id, { active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: LOCATIONS_QUERY_KEY });
    },
  });
}
