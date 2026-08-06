import { randomUUID } from 'node:crypto';
import { IpcEvent } from '@jarvis/protocol';
import type { BrowserWindow } from 'electron';

export interface PendingApproval { id: string; toolName: string; args: Record<string, unknown>; prompt: string }

export class ApprovalCenter {
  private pending = new Map<string, PendingApproval>();
  // J2 (M3 final review): if the renderer never responds (window closed, modal
  // not mounted, renderer crash), auto-deny after this long so the awaiting
  // task can never hang forever and wedge the task queue.
  private static readonly AUTO_DENY_MS = 60_000;

  constructor(private getWindow: () => BrowserWindow | null) {}

  request(req: { toolName: string; args: Record<string, unknown>; prompt: string }): Promise<boolean> {
    const id = randomUUID();
    return new Promise((resolve) => {
      const record: PendingApproval & { resolve: (ok: boolean) => void } = { ...req, id, resolve };
      const win = this.getWindow();
      if (!win) {
        // No renderer is attached (headless task, window closed, tests with a
        // null window). Resolve false immediately instead of leaving the
        // promise pending forever — the engine records a denied tool turn and
        // the task continues rather than wedging the queue.
        (record as PendingApproval & { resolve: (ok: boolean) => void }).resolve(false);
        return;
      }
      this.pending.set(id, record);
      win.webContents.send(IpcEvent.taskLog, { id: 'approval', line: `approval: ${req.toolName}` });
      win.webContents.send(IpcEvent.approvalRequest, { id, toolName: req.toolName, args: req.args, prompt: req.prompt });
      // Safety net: a request with no renderer response must never hang a task.
      const timer = setTimeout(() => {
        const r = this.pending.get(id);
        if (r) { (r as PendingApproval & { resolve: (ok: boolean) => void }).resolve(false); this.pending.delete(id); }
      }, ApprovalCenter.AUTO_DENY_MS);
      timer.unref?.();
    });
  }

  resolve(id: string, ok: boolean): void {
    const record = this.pending.get(id);
    if (record) { (record as PendingApproval & { resolve: (ok: boolean) => void }).resolve(ok); this.pending.delete(id); }
  }
}
