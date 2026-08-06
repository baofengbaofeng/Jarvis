import type { ReactNode } from 'react';
import './Sidebar.css';

export type SidebarProps = {
  brand?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
};

export function Sidebar({ brand, footer, children }: SidebarProps) {
  return (
    <aside className="jui-sidebar" data-testid="jui-sidebar">
      {brand != null && <div className="jui-sidebar__brand">{brand}</div>}
      <nav className="jui-sidebar__nav">{children}</nav>
      {footer != null && <div className="jui-sidebar__footer">{footer}</div>}
    </aside>
  );
}
