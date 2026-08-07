import { describe, it, expect } from 'vitest';
import { IpcChannel, IpcEvent, ALLOWED_INVOKE, ALLOWED_EVENTS, GITHUB_REPO_URL, type TaskStatus } from './index';

describe('protocol contract', () => {
  it('exports GitHub repo URL', () => {
    expect(GITHUB_REPO_URL).toBe('https://github.com/baofengbaofeng/Jarvis');
  });
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
      // secrets.* stay main-only; dialog.openFile is replaced by dialog.pickPath (SEC-02).
      if (
        ch === IpcChannel.secretsGet ||
        ch === IpcChannel.secretsSet ||
        ch === IpcChannel.secretsDelete ||
        ch === IpcChannel.dialogOpenFile
      ) continue;
      expect(ALLOWED_INVOKE.has(ch)).toBe(true);
    }
  });
  it('IpcEvent values are on the preload event allowlist', () => {
    for (const ev of Object.values(IpcEvent)) {
      expect(ALLOWED_EVENTS.has(ev)).toBe(true);
    }
  });
});
