import { describe, it, expect } from 'vitest';
import { createApprovalGate } from './ApprovalGate';

describe('ApprovalGate', () => {
  const gate = createApprovalGate();

  it('auto-approves safe file read', () => {
    expect(gate.evaluate('read_file', { path: '/ws/a.txt' }, { allowAlways: ['read_file'] })).toBe('allow');
  });

  it('flags rm -rf command', () => {
    expect(gate.evaluate('run_shell', { command: 'rm -rf /tmp/x' }, { allowAlways: [] })).toBe('deny');
  });

  it('flags mcp first call', () => {
    expect(gate.evaluate('mcp:fs:read', {}, { allowAlways: [] })).toBe('deny');
  });
});
