import { useEffect, useState } from 'react';
import { Toast, ToastHost } from '@jarvis/ui';
import { subscribeToasts, type Toast as ToastItem } from '../../stores/toast-store';

export function ToastHostView() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => subscribeToasts(setItems), []);
  return (
    <ToastHost>
      {items.map(t => (
        <Toast key={t.id} message={t.message} kind={t.kind} testId={`toast-${t.kind}`} />
      ))}
    </ToastHost>
  );
}

// Keep the original export name for App.tsx compatibility
export { ToastHostView as ToastHost };
