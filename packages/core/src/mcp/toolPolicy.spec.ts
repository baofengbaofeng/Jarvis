import { describe, expect, it } from 'vitest';
import { filterMcpToolNames, normalizeAutoApprove } from './toolPolicy';

describe('filterMcpToolNames', () => {
  const tools = ['read_file', 'write_file', 'list_dir'];

  it('blocks listed tools', () => {
    expect(filterMcpToolNames(tools, { blockedTools: ['write_file'] })).toEqual(['read_file', 'list_dir']);
  });

  it('allows only allowlisted tools when set', () => {
    expect(filterMcpToolNames(tools, { allowedTools: ['read_file', 'list_dir'] })).toEqual(['read_file', 'list_dir']);
  });

  it('treats null/omit allowedTools as all (minus blocked)', () => {
    expect(filterMcpToolNames(tools, { allowedTools: null })).toEqual(tools);
    expect(filterMcpToolNames(tools, {})).toEqual(tools);
  });
});

describe('normalizeAutoApprove', () => {
  it('prefixes bare names and keeps full ids', () => {
    expect(normalizeAutoApprove('fs', ['read_file', 'mcp:fs:list_dir'])).toEqual([
      'mcp:fs:read_file',
      'mcp:fs:list_dir',
    ]);
  });
});
