import type { ButtonHTMLAttributes, ReactNode } from 'react';
import './Button.css';

export type ButtonProps = {
  variant?: 'primary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
  children: ReactNode;
  onClick?: () => void;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'onClick'>;

export function Button({
  variant = 'ghost',
  size = 'md',
  disabled = false,
  type = 'button',
  className,
  children,
  onClick,
  ...rest
}: ButtonProps) {
  const classes = [
    'jui-btn',
    `jui-btn--${variant}`,
    `jui-btn--${size}`,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled}
      onClick={onClick}
      {...rest}
    >
      {children}
    </button>
  );
}
