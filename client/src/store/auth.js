import { create } from 'zustand';
import { readToken, readUser, writeSession, clearSessionStorage, tokenIsValid, sessionEvents } from './session';
import { AuthAPI } from '../lib/api';

const initialToken = readToken();
const initialValid = tokenIsValid(initialToken);
if (!initialValid && initialToken) clearSessionStorage();

export const useAuth = create((set, get) => ({
  token: initialValid ? initialToken : null,
  user: initialValid ? readUser() : null,
  expiredMessage: '',

  isAuthenticated: () => tokenIsValid(get().token),

  setSession: ({ user, token }) => {
    if (!token || !user) throw new Error('Invalid session payload');
    writeSession({ token, user });
    set({ user, token, expiredMessage: '' });
  },

  updateUser: (user) => {
    writeSession({ token: get().token, user });
    set({ user });
  },

  clearSession: (message = '') => {
    clearSessionStorage();
    set({ user: null, token: null, expiredMessage: message });
  },

  logout: async () => {
    try {
      await AuthAPI.logout();
    } catch {
      /* the token is discarded locally regardless */
    }
    get().clearSession('');
  },
}));

// The API client fires this when a request comes back 401.
sessionEvents.addEventListener('expired', (e) => {
  useAuth.getState().clearSession(e.detail || 'Your session has expired. Please sign in again.');
});

// Proactively expire the session when the token's exp passes while the tab is open.
setInterval(() => {
  const { token, clearSession } = useAuth.getState();
  if (token && !tokenIsValid(token)) clearSession('Your session has expired. Please sign in again.');
}, 30000);

export const isAuthenticated = () => useAuth.getState().isAuthenticated();
