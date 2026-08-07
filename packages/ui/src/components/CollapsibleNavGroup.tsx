import { useState, type ReactNode } from 'react';
import './CollapsibleNavGroup.css';

export type CollapsibleNavGroupProps = {
  label: string;
  children: ReactNode;
  defaultOpen?: boolean;
};

export function CollapsibleNavGroup({ label, children, defaultOpen = true }: CollapsibleNavGroupProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="jui-collapsible-nav">
      <button
        type="button"
        className="jui-collapsible-nav__toggle"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        <span>{label}</span>
        <span className="jui-collapsible-nav__chevron">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="jui-collapsible-nav__items">{children}</div>}
    </div>
  );
}
