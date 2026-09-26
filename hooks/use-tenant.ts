"use client";

import { useQuery } from "@tanstack/react-query";

export interface TenantPublicInfo {
  id: string;
  slug: string;
  businessName: string;
  status: string;
}

export function useTenant(slug: string) {
  return useQuery({
    queryKey: ["tenant", slug],
    queryFn: async (): Promise<TenantPublicInfo> => {
      const response = await fetch(`/api/tenant/${slug}`);
      const json = await response.json();

      if (!json.success) {
        throw new Error(json.error || "Tenant not found");
      }

      return json.data;
    },
    enabled: !!slug,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    retry: false,
  });
}
