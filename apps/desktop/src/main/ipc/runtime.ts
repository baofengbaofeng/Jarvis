import type { IpcMainInvokeEvent } from 'electron';

export interface RuntimeStatusData {
  registered: boolean;
  busy: boolean;
  activeTasks: number;
  lastHeartbeatAt: number;
  serverUrl: string;
  protocol: string;
  mode: 'local' | 'runtime_registered' | 'runtime_busy';
}

export function deriveRuntimeMode(registered: boolean, busy: boolean): RuntimeStatusData['mode'] {
  if (!registered) return 'local';
  return busy ? 'runtime_busy' : 'runtime_registered';
}

export interface ConflictItem {
  taskId: string;
  skill?: { name: string; localPath?: string; multicaPath?: string };
  mcp?: { name: string; localCommand?: string; multicaCommand?: string };
  resolved: boolean;
}

export function registerRuntimeHandlers(
  register: (channel: string, handler: (...args: any[]) => unknown) => void,
  getStatus: () => RuntimeStatusData | null,
  getConflicts: () => ConflictItem[],
  settings: { get(key: string): unknown; set(key: string, value: unknown): void },
): void {
  register('runtime.status', () => getStatus());
  register('runtime.conflicts', () => getConflicts());
  register('runtime.resolveConflict', (_e: IpcMainInvokeEvent, arg: { name: string; decision: string }) => {
    const existing = (settings.get('multica.conflicts') ?? {}) as Record<string, string>;
    existing[arg.name] = arg.decision;
    settings.set('multica.conflicts', existing);
    return { ok: true };
  });
}
