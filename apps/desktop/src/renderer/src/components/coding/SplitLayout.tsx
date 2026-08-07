import { useRef, useState } from 'react';
import type { ReactNode } from 'react';

export function SplitLayout({ left, right, minLeft = 220, defaultRatio = 0.35 }: { left: ReactNode; right: ReactNode; minLeft?: number; defaultRatio?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(defaultRatio);
  const dragging = useRef(false);

  const onMove = (e: MouseEvent) => {
    if (!dragging.current || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setRatio(Math.min(0.7, Math.max(minLeft / r.width, (e.clientX - r.left) / r.width)));
  };
  const onUp = () => { dragging.current = false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };

  return (
    <div ref={ref} data-testid="split-layout" className="split-layout">
      <div className="split-layout__left" style={{ width: `${ratio * 100}%` }}>{left}</div>
      <div
        className="split-layout__divider"
        onMouseDown={(e) => { dragging.current = true; document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp); e.preventDefault(); }}
      />
      <div className="split-layout__right">{right}</div>
    </div>
  );
}
