import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiGet, apiPost, SESSION_EXPIRED } from '../lib/api';
import { setActiveOrg } from '../lib/queries';
import { setSubject, type AppRole, type Membership, type Organization, type Profile } from '../lib/types';

/** Usuário logado. Mantém o formato que as telas já usavam (id, email, user_metadata). */
export interface AuthUser {
  id: string;
  email: string;
  user_metadata: { full_name?: string | null; avatar_url?: string | null };
}

interface MeResponse {
  user: { id: string; email: string; full_name: string | null; avatar_url: string | null; phone: string | null } | null;
  isAdmin?: boolean;
  mustChangePassword?: boolean;
  role?: AppRole | null;
  base?: { id: string; name: string; logo_url: string | null; subject?: string | null } | null;
  bases?: Organization[];
  memberships?: Membership[];
  suspended?: boolean;
}

interface AuthState {
  session: { user: AuthUser } | null;
  user: AuthUser | null;
  loading: boolean;
  ctxLoading: boolean;
  profile: Profile | null;
  memberships: Membership[];
  organizations: Organization[];
  activeOrgId: string | null;
  activeBase: { id: string; name: string; logo_url: string | null } | null;
  role: AppRole | null;
  isSuperadmin: boolean;
  mustChangePassword: boolean;
  suspended: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  switchOrg: (orgId: string | null) => Promise<void>;
  refreshContext: (silent?: boolean) => Promise<void>;
}

const AuthContext = createContext<AuthState>(null as unknown as AuthState);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [me, setMe] = useState<MeResponse>({ user: null });
  const [loading, setLoading] = useState(true);

  const refreshContext = useCallback(async () => {
    try {
      const next = await apiGet<MeResponse>('/api/auth/me');
      setSubject(next.base?.subject);
      setMe(next);
    } catch {
      // Sem rede: mantém o estado atual (o app continua aberto).
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshContext();
    const onExpired = () => {
      setMe({ user: null });
      queryClient.clear();
    };
    const onFocus = () => document.visibilityState === 'visible' && refreshContext();
    window.addEventListener(SESSION_EXPIRED, onExpired);
    window.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener(SESSION_EXPIRED, onExpired);
      window.removeEventListener('visibilitychange', onFocus);
    };
  }, [refreshContext, queryClient]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      await apiPost('/api/auth/login', { email, password });
      queryClient.clear();
      await refreshContext();
    },
    [queryClient, refreshContext],
  );

  const signOut = useCallback(async () => {
    await apiPost('/api/auth/logout').catch(() => {});
    queryClient.clear();
    setMe({ user: null });
  }, [queryClient]);

  const switchOrg = useCallback(
    async (orgId: string | null) => {
      await setActiveOrg(orgId);
      queryClient.clear();
      await refreshContext();
    },
    [queryClient, refreshContext],
  );

  const u = me.user;
  const user: AuthUser | null = u ? { id: u.id, email: u.email, user_metadata: { full_name: u.full_name, avatar_url: u.avatar_url } } : null;
  const profile: Profile | null = u
    ? { id: u.id, full_name: u.full_name, email: u.email, avatar_url: u.avatar_url, phone: u.phone, is_superadmin: !!me.isAdmin, active_org_id: me.base?.id ?? null }
    : null;

  return (
    <AuthContext.Provider
      value={{
        session: user ? { user } : null,
        user,
        loading,
        ctxLoading: loading,
        profile,
        memberships: me.memberships ?? [],
        organizations: me.bases ?? [],
        activeOrgId: me.base?.id ?? null,
        activeBase: me.base ?? null,
        role: me.role ?? null,
        isSuperadmin: !!me.isAdmin,
        mustChangePassword: !!me.mustChangePassword,
        suspended: !!me.suspended,
        signIn,
        signOut,
        switchOrg,
        refreshContext,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
