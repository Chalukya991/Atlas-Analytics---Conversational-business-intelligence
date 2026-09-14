import { create } from 'zustand';
import { ProjectsAPI } from '../lib/api';

/** Small shared cache so the sidebar can show recent projects without refetching per page. */
export const useProjects = create((set, get) => ({
  projects: null,
  loading: false,
  error: null,
  load: async (force = false) => {
    if (get().loading) return get().projects;
    if (get().projects && !force) return get().projects;
    set({ loading: true, error: null });
    try {
      const projects = await ProjectsAPI.list();
      set({ projects, loading: false });
      return projects;
    } catch (err) {
      set({ loading: false, error: err });
      throw err;
    }
  },
  upsert: (project) => {
    const list = get().projects || [];
    const idx = list.findIndex((p) => p.id === project.id);
    const next = idx >= 0 ? list.map((p) => (p.id === project.id ? { ...p, ...project } : p)) : [project, ...list];
    set({ projects: next });
  },
  remove: (id) => set({ projects: (get().projects || []).filter((p) => p.id !== id) }),
  reset: () => set({ projects: null, loading: false, error: null }),
}));
