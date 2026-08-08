type EnableToggleProps = {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  testId?: string;
  'aria-label'?: string;
  disabled?: boolean;
};

/** Capsule switch: green when on, gray when off. */
export function EnableToggle({
  enabled,
  onChange,
  testId,
  disabled,
  'aria-label': ariaLabel,
}: EnableToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={ariaLabel}
      disabled={disabled}
      data-testid={testId}
      className={['enable-toggle', enabled ? 'enable-toggle--on' : 'enable-toggle--off'].join(' ')}
      onClick={() => onChange(!enabled)}
    >
      <span className="enable-toggle__knob" aria-hidden />
    </button>
  );
}
