import { describe, it, expect } from 'vitest';
import {
  IpcChannel,
  IpcEvent,
  ALLOWED_INVOKE,
  ALLOWED_EVENTS,
  APP_DISPLAY_NAME,
  GITHUB_REPO_URL,
  GITHUB_ISSUES_URL,
  GITHUB_WIKI_URL,
  PROVIDER_FIELD_MAX,
  contextTokensFromInput,
  formatContextTokens,
  type TaskStatus,
} from './index';

describe('protocol contract', () => {
  it('exports provider field max lengths aligned with DB CHECKs', () => {
    expect(PROVIDER_FIELD_MAX.name).toBe(64);
    expect(PROVIDER_FIELD_MAX.baseUrl).toBe(2048);
    expect(PROVIDER_FIELD_MAX.apiKey).toBe(512);
    expect(PROVIDER_FIELD_MAX.apiKeyRef).toBe(128);
    expect(PROVIDER_FIELD_MAX.modelId).toBe(128);
    expect(PROVIDER_FIELD_MAX.modelName).toBe(64);
    expect(PROVIDER_FIELD_MAX.contextDigits).toBe(6);
    expect(PROVIDER_FIELD_MAX.contextTokens).toBe(100_000_000);
  });

  it('converts and formats model context tokens (K/M)', () => {
    expect(contextTokensFromInput(128, 'K')).toBe(128_000);
    expect(contextTokensFromInput(1, 'M')).toBe(1_000_000);
    expect(formatContextTokens(128_000)).toBe('128K');
    expect(formatContextTokens(2_000_000)).toBe('2M');
    expect(formatContextTokens(null)).toBeNull();
    expect(formatContextTokens(1500)).toBe('1500');
  });

  it('exports display name and GitHub URLs', () => {
    expect(APP_DISPLAY_NAME).toBe('J.A.R.V.I.S');
    expect(GITHUB_REPO_URL).toBe('https://github.com/baofengbaofeng/Jarvis');
    expect(GITHUB_ISSUES_URL).toBe('https://github.com/baofengbaofeng/Jarvis/issues');
    expect(GITHUB_WIKI_URL).toBe('https://github.com/baofengbaofeng/Jarvis/wiki');
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
