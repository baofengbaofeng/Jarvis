import type { SVGProps } from 'react';

/** Inline SVG icons sized to `1em` so they match surrounding text. */
export type ShellIconProps = SVGProps<SVGSVGElement>;

function base(props: ShellIconProps) {
  const { className, ...rest } = props;
  return {
    className: ['shell-icon', className].filter(Boolean).join(' '),
    width: '1em',
    height: '1em',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
    ...rest,
  };
}

export function IconPlus(props: ShellIconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconSearch(props: ShellIconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function IconBot(props: ShellIconProps) {
  return (
    <svg {...base(props)}>
      <rect x="5" y="8" width="14" height="12" rx="2" />
      <path d="M12 8V5M9 13h.01M15 13h.01M9 17h6" />
    </svg>
  );
}

export function IconMessage(props: ShellIconProps) {
  return (
    <svg {...base(props)}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/** Speech bubble with plus — “new chat”. */
export function IconMessagePlus(props: ShellIconProps) {
  return (
    <svg {...base(props)}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M12 8v5M9.5 10.5h5" />
    </svg>
  );
}

export function IconUsers(props: ShellIconProps) {
  return (
    <svg {...base(props)}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export function IconBoard(props: ShellIconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="4" width="6" height="16" rx="1" />
      <rect x="11" y="4" width="6" height="10" rx="1" />
      <rect x="19" y="4" width="2" height="7" rx="1" />
    </svg>
  );
}

export function IconCode(props: ShellIconProps) {
  return (
    <svg {...base(props)}>
      <path d="m8 8-4 4 4 4M16 8l4 4-4 4" />
    </svg>
  );
}

export function IconFile(props: ShellIconProps) {
  return (
    <svg {...base(props)}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </svg>
  );
}

export function IconWorkflow(props: ShellIconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="12" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <path d="M8.5 7.5 15 11M8.5 16.5 15 13" />
    </svg>
  );
}

export function IconCanvas(props: ShellIconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 21V9" />
    </svg>
  );
}

/**
 * Sidebar toggle — perfect square, no fill/background, minimal inset.
 * Path is inset only by half the stroke so the painted square fills the
 * viewBox edge-to-edge (avoids “floating” glyph that looks optically high).
 */
export function IconPanel(props: ShellIconProps) {
  const { className, ...rest } = props;
  return (
    <svg
      className={['shell-icon', 'shell-icon--panel', className].filter(Boolean).join(' ')}
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="butt"
      strokeLinejoin="miter"
      aria-hidden
      {...rest}
    >
      {/* 0.625 = half of 1.25 — outer stroke edge lands on the viewBox. */}
      <rect x="0.625" y="0.625" width="10.75" height="10.75" rx="1.5" />
      <path d="M4.25 0.625v10.75" />
    </svg>
  );
}

/** Classic gear / cog for the settings control. */
export function IconSettings(props: ShellIconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function IconTrash(props: ShellIconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

export function IconPencil(props: ShellIconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

/** Push-pin for sidebar pin/unpin. */
export function IconPin(props: ShellIconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 17v5M9 2h6l-1 7h3l-5 6-5-6h3L9 2z" />
    </svg>
  );
}

export function IconArrowLeft(props: ShellIconProps) {
  return (
    <svg {...base(props)}>
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}

export function IconPlug(props: ShellIconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9 7v4M15 7v4M8 11h8v2a4 4 0 0 1-4 4h0a4 4 0 0 1-4-4v-2zM12 17v4" />
    </svg>
  );
}

export function IconSparkles(props: ShellIconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3zM19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z" />
    </svg>
  );
}

export function IconServer(props: ShellIconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="4" width="18" height="6" rx="1" />
      <rect x="3" y="14" width="18" height="6" rx="1" />
      <path d="M7 7h.01M7 17h.01" />
    </svg>
  );
}

export function IconLayers(props: ShellIconProps) {
  return (
    <svg {...base(props)}>
      <path d="m12 3 9 5-9 5-9-5 9-5zM3 12l9 5 9-5M3 17l9 5 9-5" />
    </svg>
  );
}

export function IconScrollText(props: ShellIconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 4h9a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8" />
      <path d="M8 4a2 2 0 0 0-2 2v1a1 1 0 0 0 1 1h1M8 20a2 2 0 0 1-2-2v-1a1 1 0 0 1 1-1h1" />
      <path d="M11 9h5M11 13h5M11 17h3" />
    </svg>
  );
}

export function IconShield(props: ShellIconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3 4 6v6c0 5 3.5 8.5 8 9.5 4.5-1 8-4.5 8-9.5V6l-8-3z" />
    </svg>
  );
}

export function IconTerminal(props: ShellIconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m7 10 3 2-3 2M13 14h4" />
    </svg>
  );
}

export function IconDatabase(props: ShellIconProps) {
  return (
    <svg {...base(props)}>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
    </svg>
  );
}

export function IconPackage(props: ShellIconProps) {
  return (
    <svg {...base(props)}>
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3zM12 12l8-4.5M12 12v9M12 12 4 7.5" />
    </svg>
  );
}

export function IconChart(props: ShellIconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-3" />
    </svg>
  );
}

export function IconClipboardList(props: ShellIconProps) {
  return (
    <svg {...base(props)}>
      <rect x="7" y="5" width="12" height="16" rx="2" />
      <path d="M9 3h6v3H9zM10 11h6M10 15h4" />
    </svg>
  );
}

export function IconKeyboard(props: ShellIconProps) {
  return (
    <svg {...base(props)}>
      <rect x="2" y="7" width="20" height="12" rx="2" />
      <path d="M6 11h.01M10 11h.01M14 11h.01M18 11h.01M8 15h8" />
    </svg>
  );
}

export function IconCloud(props: ShellIconProps) {
  return (
    <svg {...base(props)}>
      <path d="M7 18a4 4 0 0 1-.7-7.9A5.5 5.5 0 0 1 17.5 9 3.5 3.5 0 0 1 18 18H7z" />
    </svg>
  );
}

export function IconGlobe(props: ShellIconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.8 2.5 15.2 0 18M12 3c-2.5 2.8-2.5 15.2 0 18" />
    </svg>
  );
}

export function IconPalette(props: ShellIconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3a9 9 0 1 0 0 18h1.5a2.5 2.5 0 0 0 0-5H13a1.5 1.5 0 0 1 0-3h3.5A9 9 0 0 0 12 3z" />
      <circle cx="7.5" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle cx="10" cy="7" r="1" fill="currentColor" stroke="none" />
      <circle cx="14" cy="7.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
