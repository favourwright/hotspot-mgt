import { create } from "zustand";
import { User } from "@firebase/auth";
import type { TenantSummary } from "@/lib/account-client";

interface AuthState {
  // Existing - unchanged
  user: User | null;
  userRole: "superadmin" | "owner" | "customer" | null;
  loading: boolean;
  // New - tenant context
  tenant: TenantSummary | null;
  tenantId: string | null;
  // Existing actions - unchanged
  setUser: (user: User | null) => void;
  setUserRole: (role: "superadmin" | "owner" | "customer" | null) => void;
  setLoading: (loading: boolean) => void;
  reset: () => void;
  // New actions
  setTenant: (tenant: TenantSummary | null) => void;
  setTenantId: (tenantId: string | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  // Existing state
  user: null,
  userRole: null,
  loading: true,
  // New state
  tenant: null,
  tenantId: null,
  // Existing actions
  setUser: (user) => set({ user }),
  setUserRole: (userRole) => set({ userRole }),
  setLoading: (loading) => set({ loading }),
  reset: () =>
    set({
      user: null,
      userRole: null,
      loading: false,
      tenant: null,
      tenantId: null,
    }),
  // New actions
  setTenant: (tenant) => set({ tenant }),
  setTenantId: (tenantId) => set({ tenantId }),
}));
