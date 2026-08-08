import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import './Modal.css';

export type ModalMessageProps = {
  children: ReactNode;
  className?: string;
  testId?: string;
};

function isSingleLine(el: HTMLElement): boolean {
  const style = getComputedStyle(el);
  let lineHeight = parseFloat(style.lineHeight);
  if (Number.isNaN(lineHeight)) {
    const fontSize = parseFloat(style.fontSize);
    lineHeight = (Number.isNaN(fontSize) ? 16 : fontSize) * 1.5;
  }
  return el.scrollHeight <= lineHeight + 1;
}

/** Modal body copy: centered when one line, left-aligned when wrapped. */
export function ModalMessage({ children, className, testId }: ModalMessageProps) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [singleLine, setSingleLine] = useState(true);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => setSingleLine(isSingleLine(el));
    update();

    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [children]);

  const classes = [
    'jui-modal-message',
    singleLine ? 'jui-modal-message--center' : 'jui-modal-message--start',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <p ref={ref} className={classes} data-testid={testId} data-align={singleLine ? 'center' : 'start'}>
      {children}
    </p>
  );
}
