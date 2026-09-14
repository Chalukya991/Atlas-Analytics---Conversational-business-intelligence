import axios from 'axios';
import { readToken, clearSessionStorage, sessionEvents } from '../store/session';

export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000/api/v1';

export const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
  timeout: 60000,
});

api.interceptors.request.use((config) => {
  const token = readToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    const status = error.response?.status;
    const isAuthEndpoint = /\/auth\/(login|register)$/.test(error.config?.url || '');
    if (status === 401 && !isAuthEndpoint) {
      clearSessionStorage();
      sessionEvents.dispatchEvent(new CustomEvent('expired', { detail: error.response?.data?.message }));
    }
    return Promise.reject(error);
  },
);

export function getErrorMessage(error) {
  if (!error) return 'Something went wrong.';
  if (error.code === 'ECONNABORTED') return 'The request timed out. Check your connection and try again.';
  if (error.response?.status === 429) return 'Too many requests. Please wait a moment.';
  if (!error.response && error.request) return 'Cannot reach the server. Check that the API is running.';
  return error.response?.data?.message || error.message || 'Something went wrong.';
}

export async function apiUpload(projectId, file, onProgress) {
  const form = new FormData();
  form.append('file', file);
  return api.post(`/projects/${projectId}/files`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 10 * 60 * 1000,
    onUploadProgress: (e) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
    },
  });
}

/** Download an authenticated resource as a file. */
export async function apiDownload(url, fallbackName) {
  const res = await api.get(url, { responseType: 'blob', timeout: 5 * 60 * 1000 });
  const disposition = res.headers['content-disposition'] || '';
  const match = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  const filename = match ? decodeURIComponent(match[1]) : fallbackName;
  const blobUrl = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
}

// ---- Typed endpoints -------------------------------------------------------

export const AuthAPI = {
  login: (email, password) => api.post('/auth/login', { email, password }).then((r) => r.data),
  register: (name, email, password) => api.post('/auth/register', { name, email, password }).then((r) => r.data),
  me: () => api.get('/auth/me').then((r) => r.data.user),
  logout: () => api.post('/auth/logout'),
};

export const ProjectsAPI = {
  list: () => api.get('/projects').then((r) => r.data.projects),
  get: (id) => api.get(`/projects/${id}`).then((r) => r.data),
  create: (body) => api.post('/projects', body).then((r) => r.data),
  update: (id, body) => api.patch(`/projects/${id}`, body).then((r) => r.data),
  remove: (id) => api.delete(`/projects/${id}`),
};

export const WorkspaceAPI = {
  files: (p) => api.get(`/projects/${p}/files`).then((r) => r.data.files),
  deleteFile: (p, fileId) => api.delete(`/projects/${p}/files/${fileId}`),
  datasets: (p) => api.get(`/projects/${p}/datasets`).then((r) => r.data.datasets),
  preview: (p, datasetId, params) => api.get(`/projects/${p}/datasets/${datasetId}/preview`, { params }).then((r) => r.data),
  analyses: (p) => api.get(`/projects/${p}/analyses`).then((r) => r.data.analyses),
  analysis: (p, id) => api.get(`/projects/${p}/analyses/${id}`).then((r) => r.data),
  ask: (p, body) => api.post(`/projects/${p}/chat`, body).then((r) => r.data),
  deleteAnalysis: (p, id) => api.delete(`/projects/${p}/analyses/${id}`),
  exportCsv: (p, id, name) => apiDownload(`/projects/${p}/analyses/${id}/export.csv`, `${name || 'analysis'}.csv`),
  reports: (p) => api.get(`/projects/${p}/reports`).then((r) => r.data.reports),
  createReport: (p, body) => api.post(`/projects/${p}/reports`, body).then((r) => r.data),
  downloadReport: (p, report) => apiDownload(`/projects/${p}/reports/${report.id}/download`, `${report.name}-v${report.version}.${report.format}`),
  deleteReport: (p, id) => api.delete(`/projects/${p}/reports/${id}`),
};
