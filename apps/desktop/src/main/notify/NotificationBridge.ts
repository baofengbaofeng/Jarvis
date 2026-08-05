import { Notification } from 'electron';

// I5: desktop notification bridge. Lazy-imported by the task/squad hooks (see
// tasks.ts/squad.ts) so Node specs never load this module at import time. Even
// when it IS loaded there (a task completes in a vitest run), the 'electron'
// package resolves to its CJS path-string default export, so the destructured
// Notification is undefined — guard on it so the bridge is a safe no-op outside
// Electron instead of throwing on Notification.isSupported().
export function showSystemNotification(title: string, body: string): void {
  if (typeof Notification === 'undefined' || !Notification.isSupported()) return;
  new Notification({ title, body }).show();
}
