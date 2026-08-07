import type { ButtonHTMLAttributes, ReactNode } from 'react';
import './IconButton.css';

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
  size?: 'sm' | 'md';
  variant?: 'ghost' | 'primary' | 'danger';
};

export function IconButton({
  label,
  children,
  size = 'md',
  variant = 'ghost',
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  const classes = ['jui-icon-btn', `jui-icon-btn--${size}`, `jui-icon-btn--${variant}`, className].filter(Boolean).join(' ');
  return (
    <button type={type} className={classes} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}
