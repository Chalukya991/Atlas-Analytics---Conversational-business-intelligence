/**
 * Low-level session storage helpers shared by the API client and the auth
 * store. Kept dependency-free so api.js and auth.js do not import each other.
 */
const TOKEN_KEY = 'atlas.token';
const USER_KEY = 'atlas.user';

export const sessionEvents = new EventTarget();

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode); session stays in memory */
  }
}

let memoryToken = null;
let memoryUser = null;

export function readToken() {
  return memoryToken || safeGet(TOKEN_KEY);
}

export function readUser() {
  if (memoryUser) return memoryUser;
  try {
    return JSON.parse(safeGet(USER_KEY) || 'null');
  } catch {
    return null;
  }
}

export function writeSession({ token, user }) {
  memoryToken = token;
  memoryUser = user;
  safeSet(TOKEN_KEY, token);
  safeSet(USER_KEY, JSON.stringify(user));
}

export function clearSessionStorage() {
  memoryToken = null;
  memoryUser = null;
  safeSet(TOKEN_KEY, null);
  safeSet(USER_KEY, null);
}

/** Decode a JWT payload without verifying (verification happens server-side). */
export function decodeToken(token) {
  try {
    const [, payload] = token.split('.');
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function tokenIsValid(token) {
  if (!token) return false;
  const payload = decodeToken(token);
  if (!payload) return false;
  if (payload.exp && payload.exp * 1000 <= Date.now() + 5000) return false;
  return true;
}
