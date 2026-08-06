export interface Toast { id: string; kind: 'info' | 'success' | 'error'; message: string }
let toasts: Toast[] = [];
const listeners = new Set<(ts: Toast[]) => void>();
export function toast(kind: Toast['kind'], message: string): void {
  const t = { id: Math.random().toString(36).slice(2), kind, message };
  toasts = [...toasts, t];
  listeners.forEach(l => l(toasts));
  setTimeout(() => { toasts = toasts.filter(x => x.id !== t.id); listeners.forEach(l => l(toasts)); }, 4000);
}
export function subscribeToasts(fn: (ts: Toast[]) => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }

// Test-only reset so specs start from an empty queue (the store is module-level
// state; a toast left by an earlier spec would otherwise bleed into the next).
export function clearToasts(): void {
  toasts = [];
  listeners.forEach(l => l(toasts));
}

// I5 (M6 Task 8): toast:push routed in initIpcSubscriptions().
