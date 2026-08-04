// M4 Task 6 (E1/L27): pure debounce helper for the (deferred) fs.watch
// incremental reindex — coalesces a burst of file-change events into one
// trailing call after `ms` of quiet. Purely timer-based; no I/O, no state
// outside the returned closure.
export function debounce<T extends unknown[]>(fn: (...args: T) => void, ms: number): (...args: T) => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...args: T) => { if (t) clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
