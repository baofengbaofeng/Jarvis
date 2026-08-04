import { useEffect, type ReactNode } from 'react';
import { useTheme } from './theme-store';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const mode = useTheme((s) => s.mode);
  const resolved = useTheme((s) => s.resolved);
  const theme = resolved(mode);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => document.documentElement.setAttribute('data-theme', resolved(mode, mq.matches));
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mode, resolved]);

  return <>{children}</>;
}
