import type { ReactNode } from 'react';
import './AppShell.css';

export type AppShellProps = {
  sidebar: ReactNode;
  topBar?: ReactNode;
  mainFooter?: ReactNode;
  children: ReactNode;
};

export function AppShell({ sidebar, topBar, mainFooter, children }: AppShellProps) {
  return (
    <div className="jui-appshell" data-testid="jui-appshell">
      <div className="jui-appshell__sidebar">{sidebar}</div>
      {topBar != null && <div className="jui-appshell__topbar">{topBar}</div>}
      <div className="jui-appshell__main-col">
        <main className="jui-appshell__main">{children}</main>
        {mainFooter != null && (
          <div className="jui-appshell__footer" data-testid="jui-appshell-footer">
            {mainFooter}
          </div>
        )}
      </div>
    </div>
  );
}
