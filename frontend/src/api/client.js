import axios from 'axios';

const STORAGE_KEY = 'aec.auth';

export const authStore = {
  read() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null;
    } catch {
      return null;
    }
  },
  write(value) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {
      /* private mode — session stays in memory only */
    }
  },
  clear() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* nothing to clear */
    }
  },
};

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  // AI generation can legitimately take a minute or two.
  timeout: 180000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const auth = authStore.read();
  if (auth?.accessToken) config.headers.Authorization = `Bearer ${auth.accessToken}`;
  return config;
});

let refreshing = null;

api.interceptors.response.use(
  (res) => res.data,
  async (error) => {
    const { config, response } = error;

    // One silent refresh attempt per failed request, then give up and sign out.
    if (response?.status === 401 && !config?._retried && authStore.read()?.refreshToken) {
      config._retried = true;
      try {
        refreshing =
          refreshing ||
          axios.post(`${api.defaults.baseURL}/auth/refresh`, {
            refreshToken: authStore.read().refreshToken,
          });
        const { data } = await refreshing;
        refreshing = null;

        const next = { ...authStore.read(), ...data.data };
        authStore.write(next);
        config.headers.Authorization = `Bearer ${next.accessToken}`;
        return api(config);
      } catch {
        refreshing = null;
        authStore.clear();
        if (!window.location.pathname.startsWith('/login')) {
          window.location.assign('/login?expired=1');
        }
      }
    }

    const message =
      response?.data?.message ||
      (error.code === 'ECONNABORTED'
        ? 'The request timed out. AI generation can be slow — please try again.'
        : error.message) ||
      'Something went wrong';

    return Promise.reject(
      Object.assign(new Error(message), {
        status: response?.status,
        details: response?.data?.details,
      }),
    );
  },
);

export default api;
