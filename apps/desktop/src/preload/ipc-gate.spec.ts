import { describe, expect, it } from 'vitest';
import { gateEventChannel, gateInvokeChannel } from './ipc-gate';

describe('preload ipc gate', () => {
  it('allows renderer-safe invoke channels', () => {
    expect(() => gateInvokeChannel('dialog.pickPath')).not.toThrow();
    expect(() => gateInvokeChannel('config.readPickedFile')).not.toThrow();
  });

  it('blocks dialog.openFile and fs.readFile before invoke reaches main', () => {
    expect(() => gateInvokeChannel('dialog.openFile')).toThrow(/not allowed/);
    expect(() => gateInvokeChannel('fs.readFile')).toThrow(/not allowed/);
  });

  it('blocks unknown event subscriptions', () => {
    expect(() => gateEventChannel('task:log')).not.toThrow();
    expect(() => gateEventChannel('secrets:leak')).toThrow(/not allowed/);
  });
});
