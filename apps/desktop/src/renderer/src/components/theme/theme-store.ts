import { create } from 'zustand';

export type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeState {
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  toggle: () => void;
  resolved: (m: ThemeMode, prefersDark?: boolean) => 'light' | 'dark';
}

export const createThemeStore = (prefersDarkFn: () => boolean = () =>
  window.matchMedia('(prefers-color-scheme: dark)').matches) => {
  return create<ThemeState>((set) => ({
    mode: 'light',
    setMode: (mode) => set({ mode }),
    toggle: () => set((s) => ({ mode: s.mode === 'dark' ? 'light' : 'dark' })),
    resolved: (m, prefersDark = prefersDarkFn()) => (m === 'system' ? (prefersDark ? 'dark' : 'light') : m)
  }));
};

export const useTheme = createThemeStore();
