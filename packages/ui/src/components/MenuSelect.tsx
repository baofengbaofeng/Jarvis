import { useEffect, useId, useRef, useState } from 'react';
import './MenuSelect.css';

export type MenuSelectOption = { value: string; label: string };

export type MenuSelectProps = {
  value: string;
  options: MenuSelectOption[];
  onChange: (value: string) => void;
  className?: string;
  testId?: string;
  disabled?: boolean;
  'aria-label'?: string;
};

/** Custom dropdown (not a native `<select>`). */
export function MenuSelect({
  value,
  options,
  onChange,
  className,
  testId,
  disabled,
  'aria-label': ariaLabel,
}: MenuSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const classes = ['jui-menu-select', open ? 'jui-menu-select--open' : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <div ref={rootRef} className={classes} data-testid={testId}>
      <button
        type="button"
        className="jui-menu-select__trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        data-testid={testId ? `${testId}-trigger` : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="jui-menu-select__value">{selected?.label ?? value}</span>
        <span className="jui-menu-select__chevron" aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <ul
          id={listId}
          className="jui-menu-select__list"
          role="listbox"
          data-testid={testId ? `${testId}-list` : undefined}
        >
          {options.map((opt) => (
            <li key={opt.value} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={opt.value === value}
                className={[
                  'jui-menu-select__option',
                  opt.value === value ? 'jui-menu-select__option--active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                data-testid={testId ? `${testId}-option-${opt.value}` : undefined}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                {opt.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
