import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

export type Theme = 'dark' | 'light';
export type Accent = 'iris' | 'ember' | 'jade' | 'rose' | 'graphite';

const STORAGE_KEY = 'mentoros-theme';
const ACCENT_KEY = 'mentoros-accent';

/** Picker metadata — swatch mirrors each accent's aurora gradient. */
export const ACCENTS: Array<{ id: Accent; label: string; swatch: string }> = [
  { id: 'iris', label: 'Iris', swatch: 'linear-gradient(135deg, #6d6bf6 0%, #a66bff 50%, #45d6e0 100%)' },
  { id: 'ember', label: 'Ember', swatch: 'linear-gradient(135deg, #f6716b 0%, #ffa65c 50%, #ffd166 100%)' },
  { id: 'jade', label: 'Jade', swatch: 'linear-gradient(135deg, #34d6a0 0%, #45e0c8 50%, #6bd4ff 100%)' },
  { id: 'rose', label: 'Rose', swatch: 'linear-gradient(135deg, #ff6b9d 0%, #c66bff 50%, #ff8f6b 100%)' },
  { id: 'graphite', label: 'Graphite', swatch: 'linear-gradient(135deg, #8a90a0 0%, #c2c8d4 50%, #6a7180 100%)' },
];

interface ThemeContextValue {
  theme: Theme;
  accent: Accent;
  setTheme: (t: Theme) => void;
  setAccent: (a: Accent) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' ? 'light' : 'dark'; // dark-first
}

function readStoredAccent(): Accent {
  const stored = localStorage.getItem(ACCENT_KEY);
  return ACCENTS.some((a) => a.id === stored) ? (stored as Accent) : 'iris';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);
  const [accent, setAccentState] = useState<Accent>(readStoredAccent);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (accent === 'iris') delete document.documentElement.dataset.accent;
    else document.documentElement.dataset.accent = accent;
    localStorage.setItem(ACCENT_KEY, accent);
  }, [accent]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const setAccent = useCallback((a: Accent) => setAccentState(a), []);
  const toggle = useCallback(() => setThemeState((t) => (t === 'dark' ? 'light' : 'dark')), []);

  return (
    <ThemeContext.Provider value={{ theme, accent, setTheme, setAccent, toggle }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
