import { useEffect, useState } from 'react';
import { subscribeToasts, type Toast } from '../../stores/toast-store';

export function ToastHost() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => subscribeToasts(setItems), []);
  return (
    <div data-testid="toast-host">
      {items.map(t => <div key={t.id} data-testid={`toast-${t.kind}`} className={`toast toast--${t.kind}`}>{t.message}</div>)}
    </div>
  );
}
