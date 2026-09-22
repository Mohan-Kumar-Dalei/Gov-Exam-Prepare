import api, { authStore } from './client.js';

export const authApi = {
  signup: (body) => api.post('/auth/signup', body),
  login: (body) => api.post('/auth/login', body),
  me: () => api.get('/auth/me'),
  updateProfile: (body) => api.patch('/auth/me', body),
  changePassword: (body) => api.post('/auth/change-password', body),
};

export const documentApi = {
  upload: (file, onProgress) => {
    const form = new FormData();
    form.append('pdf', file);
    return api.post('/documents/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
      },
    });
  },
  status: (id) => api.get(`/documents/${id}/status`),
  list: (params) => api.get('/documents', { params }),
  get: (id) => api.get(`/documents/${id}`),
  text: (id) => api.get(`/documents/${id}/text`),
  reanalyze: (id) => api.post(`/documents/${id}/reanalyze`),
  remove: (id) => api.delete(`/documents/${id}`),
};

export const examApi = {
  list: (params) => api.get('/exams', { params }),
  get: (id) => api.get(`/exams/${id}`),
  syllabus: (id) => api.get(`/exams/${id}/syllabus`),
  activate: (id) => api.post(`/exams/${id}/activate`),
  update: (id, body) => api.patch(`/exams/${id}`, body),
  remove: (id) => api.delete(`/exams/${id}`),
};

/** Shared SSE reader: POST or GET, dispatching each frame to onEvent. */
async function readSse({ url, method = 'GET', body, onEvent, signal }) {
  const auth = authStore.read();
  const res = await fetch(url, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(auth?.accessToken ? { Authorization: `Bearer ${auth.accessToken}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal,
  });

  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Stream failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      const event = frame.match(/^event: (.+)$/m)?.[1];
      const raw = frame.match(/^data: (.*)$/m)?.[1];
      if (!event || raw === undefined) continue;

      // Only the parse is guarded. Wrapping the handler too would swallow the
      // errors it deliberately throws — including the server's own `error`
      // event — leaving the UI waiting forever with nothing to show.
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        continue; // a malformed frame should not drop the stream
      }
      onEvent(event, payload);
    }
  }
}

export const learningApi = {
  lesson: (examId, params) => api.get(`/learning/${examId}/lesson`, { params }),

  /** Streams the teaching prose, then the structured revision material. */
  lessonStream: (examId, params, onEvent, signal) =>
    readSse({
      url: `${api.defaults.baseURL}/learning/${examId}/lesson/stream?${new URLSearchParams(params)}`,
      onEvent,
      signal,
    }),
  complete: (examId, body) => api.post(`/learning/${examId}/lesson/complete`, body),
  list: (examId) => api.get(`/learning/${examId}/lessons`),
  next: (examId) => api.get(`/learning/${examId}/next`),
};

export const testApi = {
  startQuiz: (body) => api.post('/tests/quiz', body),
  startMock: (body) => api.post('/tests/mock', body),
  list: (params) => api.get('/tests', { params }),
  get: (id) => api.get(`/tests/${id}`),
  submit: (id, body) => api.post(`/tests/${id}/submit`, body),
  abandon: (id) => api.delete(`/tests/${id}`),
};

export const analyticsApi = {
  dashboard: (params) => api.get('/analytics/dashboard', { params }),
  topics: (params) => api.get('/analytics/topics', { params }),
  subjects: (params) => api.get('/analytics/subjects', { params }),
  trend: (params) => api.get('/analytics/trend', { params }),
  activity: (params) => api.get('/analytics/activity', { params }),
  readiness: (params) => api.get('/analytics/readiness', { params }),
  weakTopics: (params) => api.get('/analytics/weak-topics', { params }),
};

export const roadmapApi = {
  generate: (body) => api.post('/roadmap', body),
  get: (params) => api.get('/roadmap', { params }),
  today: (params) => api.get('/roadmap/today', { params }),
  markDay: (id, day, body) => api.patch(`/roadmap/${id}/day/${day}`, body),
};

export const keyApi = {
  list: () => api.get('/keys'),
  add: (body) => api.post('/keys', body),
  update: (id, body) => api.patch(`/keys/${id}`, body),
  revive: (id) => api.post(`/keys/${id}/revive`),
  reviveEnv: () => api.post('/keys/env/revive'),
  test: (id) => api.post(`/keys/${id}/test`),
  remove: (id) => api.delete(`/keys/${id}`),
};

export const mentorApi = {
  chat: (body) => api.post('/mentor/chat', body),

  /**
   * Streaming chat over Server-Sent Events.
   *
   * EventSource cannot POST, so this reads the response body directly.
   * Calls `onEvent(name, data)` for each frame: `start` carries the
   * conversation id and action buttons, `chunk` carries reply text.
   */
  stream: (body, onEvent, signal) =>
    readSse({
      url: `${api.defaults.baseURL}/mentor/stream`,
      method: 'POST',
      body,
      onEvent,
      signal,
    }),
  conversations: () => api.get('/mentor/conversations'),
  conversation: (id) => api.get(`/mentor/conversations/${id}`),
  remove: (id) => api.delete(`/mentor/conversations/${id}`),
};
