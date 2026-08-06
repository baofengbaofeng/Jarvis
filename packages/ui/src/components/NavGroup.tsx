import type { ReactNode } from 'react';
import './NavGroup.css';

export type NavGroupProps = {
  label: ReactNode;
  children: ReactNode;
};

export function NavGroup({ label, children }: NavGroupProps) {
  return (
    <div className="jui-navgroup">
      <div className="jui-navgroup__label">{label}</div>
      <div className="jui-navgroup__items">{children}</div>
    </div>
  );
}
