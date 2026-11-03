import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api } from "./api";
import type { User } from "./types";

interface AuthCtx {
  user: User | null;
  loading: boolean;
  refresh: () => Promise<unknown>;
  logout: () => Promise<void>;
  setUser: (u: User | null) => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<{ user: User | null }>("/api/auth/me"),
    staleTime: 60_000,
  });
  const logoutM = useMutation({ mutationFn: () => api.post("/api/auth/logout") });
  const value: AuthCtx = {
    user: q.data?.user ?? null,
    loading: q.isLoading,
    refresh: () => q.refetch(),
    setUser: (u) => {
      qc.setQueryData<{ user: User | null }>(["me"], { user: u });
    },
    logout: async () => {
      await logoutM.mutateAsync().catch(() => undefined);
      qc.clear();
      qc.setQueryData<{ user: User | null }>(["me"], { user: null });
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading)
    return (
      <div className="grid min-h-screen place-items-center text-muted">
        <div className="flex items-center gap-3 text-sm">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" /> Loading FinLex…
        </div>
      </div>
    );
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}
