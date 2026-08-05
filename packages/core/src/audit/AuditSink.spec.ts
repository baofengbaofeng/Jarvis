import { describe, it, expect } from 'vitest';
import { MemorySink, type AuditEntry } from './AuditSink';

describe('MemorySink', () => {
  it('collects written entries in order', () => {
    const sink = new MemorySink();
    const e: AuditEntry = { ts: '2026-08-03T00:00:00Z', kind: 'tool_call', actor: 'agent', action: 'shell.exec', result: 'ok' };
    sink.write(e);
    expect(sink.all()).toEqual([e]);
  });
});
