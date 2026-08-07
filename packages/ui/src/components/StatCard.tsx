import type { ReactNode } from 'react';
import './StatCard.css';

export type StatCardProps = {
  label: string;
  value: ReactNode;
  hint?: string;
  className?: string;
};

export function StatCard({ label, value, hint, className }: StatCardProps) {
  const classes = ['jui-stat-card', className].filter(Boolean).join(' ');
  return (
    <div className={classes}>
      <div className="jui-stat-card__label">{label}</div>
      <div className="jui-stat-card__value">{value}</div>
      {hint != null && <div className="jui-stat-card__hint">{hint}</div>}
    </div>
  );
}
