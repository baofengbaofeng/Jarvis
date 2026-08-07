import type { ReactNode } from 'react';
import './PageHeader.css';

export type PageHeaderProps = {
  title: string;
  subtitle?: string;
  badges?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({ title, subtitle, badges, actions, className }: PageHeaderProps) {
  const classes = ['jui-page-header', className].filter(Boolean).join(' ');
  return (
    <header className={classes}>
      <div className="jui-page-header__main">
        <h1 className="jui-page-header__title">{title}</h1>
        {subtitle != null && <p className="jui-page-header__subtitle">{subtitle}</p>}
      </div>
      {(badges != null || actions != null) && (
        <div className="jui-page-header__aside">
          {badges != null && <div className="jui-page-header__badges">{badges}</div>}
          {actions != null && <div className="jui-page-header__actions">{actions}</div>}
        </div>
      )}
    </header>
  );
}
