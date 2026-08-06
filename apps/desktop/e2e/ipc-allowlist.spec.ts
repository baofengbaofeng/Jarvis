import { test, expect } from '@playwright/test';
import { ALLOWED_INVOKE, ALLOWED_EVENTS, IpcChannel, IpcEvent } from '@jarvis/protocol';

/** ROB-05: preload allowlist must cover every typed IPC contract constant. */
test.describe('IPC allowlist contract', () => {
  test('every IpcChannel value is allowed for renderer invoke', () => {
    const blocked = new Set([IpcChannel.secretsGet, IpcChannel.secretsSet, IpcChannel.secretsDelete]);
    for (const channel of Object.values(IpcChannel)) {
      if (blocked.has(channel)) continue;
      expect(ALLOWED_INVOKE.has(channel), `missing invoke allowlist entry: ${channel}`).toBe(true);
    }
  });

  test('every IpcEvent value is allowed for renderer subscription', () => {
    for (const event of Object.values(IpcEvent)) {
      expect(ALLOWED_EVENTS.has(event), `missing event allowlist entry: ${event}`).toBe(true);
    }
  });

  test('secrets channels are not exposed to renderer invoke', () => {
    expect(ALLOWED_INVOKE.has(IpcChannel.secretsGet)).toBe(false);
    expect(ALLOWED_INVOKE.has(IpcChannel.secretsSet)).toBe(false);
    expect(ALLOWED_INVOKE.has(IpcChannel.secretsDelete)).toBe(false);
  });
});
