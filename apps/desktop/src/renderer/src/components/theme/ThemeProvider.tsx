import type { ReactNode } from 'react';

/**
 * Minimal placeholder ThemeProvider — replaced by Task 7 (real theme system).
 * For now it is a passthrough that renders its children unchanged.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
