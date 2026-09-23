import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { plansService } from "@/services/admin-service";
import { Plan } from "@/types/schemas";

export const PLANS_QUERY_KEY = ["plans"];

export function usePlans(locationId?: string) {
  return useQuery({
    queryKey: locationId ? [...PLANS_QUERY_KEY, locationId] : PLANS_QUERY_KEY,
    queryFn: () => plansService.getAll(locationId),
  });
}

export function useCreatePlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: plansService.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PLANS_QUERY_KEY });
    },
  });
}

export function useUpdatePlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Plan> }) =>
      plansService.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PLANS_QUERY_KEY });
    },
  });
}

export function useDeletePlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: plansService.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PLANS_QUERY_KEY });
    },
  });
}

// Toggle plan active status
export function useTogglePlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      plansService.update(id, { active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PLANS_QUERY_KEY });
    },
  });
}
