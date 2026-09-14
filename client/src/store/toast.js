import { create } from 'zustand';

let seq = 0;

export const useToasts = create((set, get) => ({
  toasts: [],
  push: ({ kind = 'info', title, body, duration = 4500 }) => {
    const id = `t${Date.now()}-${++seq}`;
    set({ toasts: [...get().toasts, { id, kind, title, body }] });
    if (duration > 0) setTimeout(() => get().dismiss(id), duration);
    return id;
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = {
  success: (title, body) => useToasts.getState().push({ kind: 'success', title, body }),
  error: (title, body) => useToasts.getState().push({ kind: 'error', title, body, duration: 7000 }),
  info: (title, body) => useToasts.getState().push({ kind: 'info', title, body }),
  warning: (title, body) => useToasts.getState().push({ kind: 'warning', title, body, duration: 6000 }),
};
