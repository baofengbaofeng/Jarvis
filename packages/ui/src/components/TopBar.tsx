import type { ReactNode } from 'react';
import './TopBar.css';

export type TopBarProps = {
  left?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
};

export function TopBar({ left, right, children }: TopBarProps) {
  return (
    <header className="jui-topbar" data-testid="jui-topbar">
      {left != null && <div className="jui-topbar__left">{left}</div>}
      {children}
      {right != null && <div className="jui-topbar__right">{right}</div>}
    </header>
  );
}
