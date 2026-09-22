import { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react';
import { authApi } from '../api/endpoints.js';
import { authStore } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => authStore.read()?.user || null);
  const [loading, setLoading] = useState(Boolean(authStore.read()?.accessToken));

  // Revalidate the cached user on boot so a revoked or stale session is caught.
  useEffect(() => {
    const stored = authStore.read();
    if (!stored?.accessToken) {
      setLoading(false);
      return;
    }
    authApi
      .me()
      .then((res) => {
        setUser(res.data.user);
        authStore.write({ ...stored, user: res.data.user });
      })
      .catch(() => {
        authStore.clear();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const persist = useCallback((payload) => {
    authStore.write(payload);
    setUser(payload.user);
  }, []);

  const login = useCallback(
    async (credentials) => {
      const res = await authApi.login(credentials);
      persist(res.data);
      return res.data.user;
    },
    [persist],
  );

  const signup = useCallback(
    async (details) => {
      const res = await authApi.signup(details);
      persist(res.data);
      return res.data.user;
    },
    [persist],
  );

  const logout = useCallback(() => {
    authStore.clear();
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const res = await authApi.me();
    setUser(res.data.user);
    authStore.write({ ...authStore.read(), user: res.data.user });
    return res.data.user;
  }, []);

  const updateUser = useCallback((patch) => {
    setUser((prev) => {
      const next = { ...prev, ...patch };
      authStore.write({ ...authStore.read(), user: next });
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      isAuthenticated: Boolean(user),
      activeExamId: user?.activeExam?._id || user?.activeExam || null,
      login,
      signup,
      logout,
      refreshUser,
      updateUser,
    }),
    [user, loading, login, signup, logout, refreshUser, updateUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
};

export default AuthContext;
