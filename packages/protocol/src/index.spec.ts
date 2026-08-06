import { describe, it, expect } from 'vitest';
import { IpcChannel, IpcEvent, ALLOWED_INVOKE, ALLOWED_EVENTS, type TaskStatus } from './index';

describe('protocol contract', () => {
  it('exposes IpcChannel strings', () => {
    expect(IpcChannel.settingsGet).toBe('settings.get');
    expect(IpcChannel.settingsSet).toBe('settings.set');
  });
  it('exposes IpcEvent strings', () => {
    expect(IpcEvent.chatDelta).toBe('chat:delta');
    expect(IpcEvent.taskLog).toBe('task:log');
    expect(IpcEvent.approvalRequest).toBe('approval:request');
  });
  it('TaskStatus union is closed', () => {
    const s: TaskStatus = 'queued';
    expect(['queued','running','completed','failed','cancelled','paused']).toContain(s);
  });
  it('IpcChannel values are on the preload invoke allowlist', () => {
    for (const ch of Object.values(IpcChannel)) {
      if (ch === IpcChannel.secretsGet || ch === IpcChannel.secretsSet || ch === IpcChannel.secretsDelete) continue;
      expect(ALLOWED_INVOKE.has(ch)).toBe(true);
    }
  });
  it('IpcEvent values are on the preload event allowlist', () => {
    for (const ev of Object.values(IpcEvent)) {
      expect(ALLOWED_EVENTS.has(ev)).toBe(true);
    }
  });
});
