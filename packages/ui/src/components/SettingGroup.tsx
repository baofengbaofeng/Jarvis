import type { ReactNode } from 'react';
import './SettingGroup.css';

export type SettingGroupProps = {
  label: string;
  children: ReactNode;
  className?: string;
};

export function SettingGroup({ label, children, className }: SettingGroupProps) {
  const classes = ['jui-setting-group', className].filter(Boolean).join(' ');
  return (
    <section className={classes}>
      <h3 className="jui-setting-group__label">{label}</h3>
      <div className="jui-setting-group__card">{children}</div>
    </section>
  );
}

export type SettingRowProps = {
  label: string;
  value?: ReactNode;
  children?: ReactNode;
  onClick?: () => void;
  className?: string;
};

export function SettingRow({ label, value, children, onClick, className }: SettingRowProps) {
  const classes = ['jui-setting-row', onClick != null ? 'jui-setting-row--clickable' : '', className].filter(Boolean).join(' ');
  const Tag = onClick != null ? 'button' : 'div';
  return (
    <Tag type={onClick != null ? 'button' : undefined} className={classes} onClick={onClick}>
      <span className="jui-setting-row__label">{label}</span>
      <span className="jui-setting-row__value">{children ?? value}</span>
    </Tag>
  );
}
