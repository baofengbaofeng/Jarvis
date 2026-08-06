import { describe, it, expect } from 'vitest';
import { ALLOWED_INVOKE, ALLOWED_EVENTS, assertAllowedInvoke, assertAllowedEvent } from './ipc-allowlist';

describe('ipc allowlist', () => {
  it('allows renderer-safe invoke channels', () => {
    expect(() => assertAllowedInvoke('chat.send')).not.toThrow();
    expect(() => assertAllowedInvoke('config.readPickedFile')).not.toThrow();
  });

  it('blocks secrets and legacy fs.readFile', () => {
    expect(() => assertAllowedInvoke('secrets.get')).toThrow(/not allowed/);
    expect(() => assertAllowedInvoke('secrets.set')).toThrow(/not allowed/);
    expect(() => assertAllowedInvoke('fs.readFile')).toThrow(/not allowed/);
    expect(ALLOWED_INVOKE.has('secrets.get')).toBe(false);
    expect(ALLOWED_INVOKE.has('fs.readFile')).toBe(false);
  });

  it('allows approval and task events', () => {
    expect(() => assertAllowedEvent('approval:request')).not.toThrow();
    expect(() => assertAllowedEvent('task:log')).not.toThrow();
    expect(ALLOWED_EVENTS.has('approval:request')).toBe(true);
  });

  it('blocks unknown events', () => {
    expect(() => assertAllowedEvent('secrets:leak')).toThrow(/not allowed/);
  });
});
