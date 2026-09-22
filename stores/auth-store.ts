import { create } from "zustand";
import { User } from "firebase/auth";

interface AuthState {
  user: User | null;
  userRole: "customer" | "admin" | null;
  loading: boolean;
  setUser: (user: User | null) => void;
  setUserRole: (role: "customer" | "admin" | null) => void;
  setLoading: (loading: boolean) => void;
  reset: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  userRole: null,
  loading: true,
  setUser: (user) => set({ user }),
  setUserRole: (userRole) => set({ userRole }),
  setLoading: (loading) => set({ loading }),
  reset: () => set({ user: null, userRole: null, loading: false }),
}));
