import type { ReactNode } from 'react';
import './AppShell.css';

export type AppShellProps = {
  sidebar: ReactNode;
  topBar?: ReactNode;
  mainFooter?: ReactNode;
  /** Optional right push panel — only then does the shell allocate a third column. */
  rightPane?: ReactNode;
  children: ReactNode;
};

export function AppShell({ sidebar, topBar, mainFooter, rightPane, children }: AppShellProps) {
  const withRight = rightPane != null;
  return (
    <div
      className={['jui-appshell', withRight ? 'jui-appshell--with-right' : ''].filter(Boolean).join(' ')}
      data-testid="jui-appshell"
    >
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
      {withRight && (
        <aside className="jui-appshell__right" data-testid="jui-appshell-right">
          {rightPane}
        </aside>
      )}
    </div>
  );
}
