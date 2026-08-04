import { randomUUID } from 'node:crypto';
import { IpcEvent } from '@jarvis/protocol';
import type { BrowserWindow } from 'electron';

export interface PendingApproval { id: string; toolName: string; args: Record<string, unknown>; prompt: string }

export class ApprovalCenter {
  private pending = new Map<string, PendingApproval>();

  constructor(private getWindow: () => BrowserWindow | null) {}

  request(req: { toolName: string; args: Record<string, unknown>; prompt: string }): Promise<boolean> {
    const id = randomUUID();
    return new Promise((resolve) => {
      const record: PendingApproval & { resolve: (ok: boolean) => void } = { ...req, id, resolve };
      this.pending.set(id, record);
      this.getWindow()?.webContents.send(IpcEvent.taskLog, { id: 'approval', line: `approval: ${req.toolName}` });
      // 渲染层注册 approval:request 监听;resolve 后清除
      // 简化:发自定义事件
      this.getWindow()?.webContents.send('approval:request', { id, toolName: req.toolName, args: req.args, prompt: req.prompt });
    });
  }

  resolve(id: string, ok: boolean): void {
    const record = this.pending.get(id);
    if (record) { (record as PendingApproval & { resolve: (ok: boolean) => void }).resolve(ok); this.pending.delete(id); }
  }
}
