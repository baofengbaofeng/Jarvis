import type { ReactNode } from 'react';
import './Tabs.css';

export type TabItem = {
  id: string;
  label: string;
  testId?: string;
};

export type TabsProps = {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
};

export function Tabs({ tabs, active, onChange, className }: TabsProps) {
  const classes = ['jui-tabs', className].filter(Boolean).join(' ');
  return (
    <div className={classes} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          data-testid={tab.testId}
          aria-selected={tab.id === active}
          className={['jui-tabs__tab', tab.id === active && 'jui-tabs__tab--active'].filter(Boolean).join(' ')}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export type TabPanelProps = {
  active: boolean;
  children: ReactNode;
  className?: string;
};

export function TabPanel({ active, children, className }: TabPanelProps) {
  if (!active) return null;
  const classes = ['jui-tabs__panel', className].filter(Boolean).join(' ');
  return <div className={classes} role="tabpanel">{children}</div>;
}
