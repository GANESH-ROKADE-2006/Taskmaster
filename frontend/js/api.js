/**
 * TaskMaster API Client
 * Communicates with the Express backend at http://localhost:3001
 */

const API_BASE = 'http://localhost:3001/api';

async function request(method, path, body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.data;
}

export const api = {
  // Health
  health: () => fetch(`${API_BASE}/health`).then(r => r.json()),

  // Tasks
  getTasks: () => request('GET', '/tasks'),
  createTask: (task) => request('POST', '/tasks', task),
  updateTask: (id, data) => request('PUT', `/tasks/${id}`, data),
  deleteTask: (id) => request('DELETE', `/tasks/${id}`),
  reorderTasks: (orderedIds) => request('PATCH', '/tasks/reorder', { orderedIds }),

  // Categories
  getCategories: () => request('GET', '/categories'),
  createCategory: (cat) => request('POST', '/categories', cat),
  updateCategory: (id, data) => request('PUT', `/categories/${id}`, data),
  deleteCategory: (id) => request('DELETE', `/categories/${id}`),
};
