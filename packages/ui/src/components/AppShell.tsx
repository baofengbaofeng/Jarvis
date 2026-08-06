import type { ReactNode } from 'react';
import './AppShell.css';

export type AppShellProps = {
  sidebar: ReactNode;
  topBar?: ReactNode;
  children: ReactNode;
};

export function AppShell({ sidebar, topBar, children }: AppShellProps) {
  return (
    <div className="jui-appshell" data-testid="jui-appshell">
      <div className="jui-appshell__sidebar">{sidebar}</div>
      {topBar != null && <div className="jui-appshell__topbar">{topBar}</div>}
      <main className="jui-appshell__main">{children}</main>
    </div>
  );
}
