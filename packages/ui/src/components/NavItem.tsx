import type { AnchorHTMLAttributes, MouseEventHandler, ReactNode } from 'react';
import './NavItem.css';

export type NavItemProps = {
  active?: boolean;
  children: ReactNode;
  href?: string;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
  className?: string;
  'data-testid'?: string;
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'onClick'>;

export function NavItem({
  active = false,
  children,
  href,
  onClick,
  className,
  'data-testid': dataTestId,
  ...rest
}: NavItemProps) {
  const classes = [
    'jui-navitem',
    active && 'jui-navitem--active',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <a
      href={href}
      className={classes}
      onClick={onClick}
      data-testid={dataTestId}
      {...rest}
    >
      {children}
    </a>
  );
}
