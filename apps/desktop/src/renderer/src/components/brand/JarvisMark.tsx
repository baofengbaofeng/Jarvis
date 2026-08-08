import { useId } from 'react';
import { APP_DISPLAY_NAME } from '@jarvis/protocol';
import './JarvisMark.css';

const SIZES = { sm: 20, md: 28, lg: 56 } as const;

export type JarvisMarkProps = {
  size?: keyof typeof SIZES;
  variant?: 'mark' | 'app';
  className?: string;
  title?: string;
};

/** Lattice mark matching apps/desktop/resources/icon.svg (I2 centered). */
export function JarvisMark({ size = 'md', variant = 'mark', className, title = APP_DISPLAY_NAME }: JarvisMarkProps) {
  const uid = useId().replace(/:/g, '');
  const px = SIZES[size];
  const gradId = `jarvis-bg-${uid}`;
  const classes = ['jarvis-mark', `jarvis-mark--${variant}`, `jarvis-mark--${size}`, className]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={classes} data-testid="jarvis-mark" data-variant={variant} style={{ width: px, height: px }} title={title}>
      <svg viewBox="0 0 128 128" width={px} height={px} role="img" aria-label={title}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#2563eb" />
            <stop offset="55%" stopColor="#0ea5e9" />
            <stop offset="100%" stopColor="#14b8a6" />
          </linearGradient>
        </defs>
        {variant === 'app' ? (
          <rect width="128" height="128" rx="28" fill={`url(#${gradId})`} />
        ) : (
          <rect width="128" height="128" fill="transparent" />
        )}
        <g
          stroke={variant === 'app' ? '#fff' : `url(#${gradId})`}
          fill="none"
          strokeLinejoin="round"
          strokeLinecap="round"
        >
          <polygon points="64,18 103.84,41 103.84,87 64,110 24.16,87 24.16,41" strokeWidth="2.8" />
          <polygon points="64,32 91.71,48 91.71,80 64,96 36.29,80 36.29,48" strokeWidth="1.8" opacity="0.9" />
          <polygon points="64,46 79.59,55 79.59,73 64,82 48.41,73 48.41,55" strokeWidth="1.6" opacity="0.8" />
          <line x1="64" y1="18" x2="64" y2="110" strokeWidth="1.5" opacity="0.5" />
          <line x1="24.16" y1="41" x2="103.84" y2="87" strokeWidth="1.4" opacity="0.4" />
          <line x1="103.84" y1="41" x2="24.16" y2="87" strokeWidth="1.4" opacity="0.4" />
          <line x1="64" y1="18" x2="36.29" y2="48" strokeWidth="1.3" opacity="0.55" />
          <line x1="64" y1="18" x2="91.71" y2="48" strokeWidth="1.3" opacity="0.55" />
          <line x1="64" y1="110" x2="36.29" y2="80" strokeWidth="1.3" opacity="0.55" />
          <line x1="64" y1="110" x2="91.71" y2="80" strokeWidth="1.3" opacity="0.55" />
          <line x1="24.16" y1="41" x2="36.29" y2="48" strokeWidth="1.2" opacity="0.5" />
          <line x1="103.84" y1="41" x2="91.71" y2="48" strokeWidth="1.2" opacity="0.5" />
          <line x1="24.16" y1="87" x2="36.29" y2="80" strokeWidth="1.2" opacity="0.5" />
          <line x1="103.84" y1="87" x2="91.71" y2="80" strokeWidth="1.2" opacity="0.5" />
          <line x1="48.41" y1="55" x2="79.59" y2="73" strokeWidth="1.2" opacity="0.65" />
          <line x1="79.59" y1="55" x2="48.41" y2="73" strokeWidth="1.2" opacity="0.65" />
        </g>
        <circle cx="64" cy="64" r="6" fill={variant === 'app' ? '#fff' : '#2563eb'} />
        <circle cx="64" cy="18" r="2.8" fill={variant === 'app' ? '#ecfeff' : '#0ea5e9'} />
        <circle cx="103.84" cy="41" r="2.4" fill={variant === 'app' ? '#ecfeff' : '#14b8a6'} />
        <circle cx="103.84" cy="87" r="2.4" fill={variant === 'app' ? '#ecfeff' : '#14b8a6'} />
        <circle cx="64" cy="110" r="2.8" fill={variant === 'app' ? '#ecfeff' : '#0ea5e9'} />
        <circle cx="24.16" cy="87" r="2.4" fill={variant === 'app' ? '#ecfeff' : '#14b8a6'} />
        <circle cx="24.16" cy="41" r="2.4" fill={variant === 'app' ? '#ecfeff' : '#14b8a6'} />
      </svg>
    </span>
  );
}
