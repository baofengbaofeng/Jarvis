import { describe, it, expect } from 'vitest';
import {
  createMcpToolFilter,
  filterToolsForMcpBindings,
  mcpServerFromToolName,
} from './toolFilter';

describe('MCP toolFilter (CORE-20)', () => {
  const all = ['read_file', 'run_shell', 'mcp:fs:read', 'mcp:git:status', 'mcp:fs:write'];

  it('parses server name from mcp:{server}:{tool}', () => {
    expect(mcpServerFromToolName('mcp:fs:read')).toBe('fs');
    expect(mcpServerFromToolName('mcp:my-server:tool:nested')).toBe('my-server');
    expect(mcpServerFromToolName('read_file')).toBeNull();
  });

  it('keeps non-MCP tools and only MCP tools for bound servers', () => {
    expect(filterToolsForMcpBindings(all, ['fs'])).toEqual([
      'read_file', 'run_shell', 'mcp:fs:read', 'mcp:fs:write',
    ]);
    expect(filterToolsForMcpBindings(all, [])).toEqual(['read_file', 'run_shell']);
  });

  it('createMcpToolFilter rejects unbound MCP tools', () => {
    const filter = createMcpToolFilter(['fs']);
    expect(filter('read_file')).toBe(true);
    expect(filter('mcp:fs:read')).toBe(true);
    expect(filter('mcp:git:status')).toBe(false);
  });
});
