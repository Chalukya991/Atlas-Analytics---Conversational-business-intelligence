import { create } from 'zustand';

const KEY = 'atlas.theme';
const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function readPref() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
}

function resolve(pref) {
  if (pref === 'system') return media && media.matches ? 'dark' : 'light';
  return pref;
}

function apply(pref) {
  const resolved = resolve(pref);
  document.documentElement.setAttribute('data-theme', resolved);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0a0f1b' : '#f4f6fa');
  return resolved;
}

export const useTheme = create((set, get) => ({
  preference: readPref(),
  resolved: resolve(readPref()),
  setPreference: (pref) => {
    try {
      localStorage.setItem(KEY, pref);
    } catch {
      /* ignore */
    }
    set({ preference: pref, resolved: apply(pref) });
  },
  toggle: () => {
    const next = get().resolved === 'dark' ? 'light' : 'dark';
    get().setPreference(next);
  },
}));

apply(readPref());
if (media) {
  media.addEventListener('change', () => {
    const { preference } = useTheme.getState();
    if (preference === 'system') useTheme.setState({ resolved: apply('system') });
  });
}
