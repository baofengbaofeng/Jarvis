import { describe, it, expect } from 'vitest';
import { IpcChannel, IpcEvent, type TaskStatus } from './index';

describe('protocol contract', () => {
  it('exposes IpcChannel strings', () => {
    expect(IpcChannel.settingsGet).toBe('settings.get');
    expect(IpcChannel.settingsSet).toBe('settings.set');
  });
  it('exposes IpcEvent strings', () => {
    expect(IpcEvent.chatDelta).toBe('chat:delta');
    expect(IpcEvent.taskLog).toBe('task:log');
  });
  it('TaskStatus union is closed', () => {
    const s: TaskStatus = 'queued';
    expect(['queued','running','completed','failed','cancelled','paused']).toContain(s);
  });
});
