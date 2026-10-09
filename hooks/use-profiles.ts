import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { profilesService } from "@/services/admin-service";

export const PROFILES_QUERY_KEY = ["profiles"];

export function useProfiles(locationId: string | null) {
  return useQuery({
    queryKey: locationId ? [...PROFILES_QUERY_KEY, locationId] : PROFILES_QUERY_KEY,
    queryFn: () => (locationId ? profilesService.getAll(locationId) : Promise.resolve([])),
    enabled: !!locationId,
  });
}

export function useCreateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      locationId,
      data,
    }: {
      locationId: string;
      data: {
        name: string;
        rateLimit?: string;
        keepaliveTimeout?: string;
        sharedUsers?: string;
      };
    }) => profilesService.create(locationId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ 
        queryKey: [...PROFILES_QUERY_KEY, variables.locationId] 
      });
    },
  });
}
