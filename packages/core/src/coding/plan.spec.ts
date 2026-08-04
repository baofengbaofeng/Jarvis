import { describe, it, expect } from 'vitest';
import { isPlanBlocked, planVisibleTools } from './plan';

const ALL = ['read_file', 'list_dir', 'write_file', 'run_shell', 'git_status', 'git_commit', 'search_code', 'mcp:fs:read'];

describe('plan mode', () => {
  it('blocks write/shell/commit/mcp tools', () => {
    expect(isPlanBlocked('write_file')).toBe(true);
    expect(isPlanBlocked('run_shell')).toBe(true);
    expect(isPlanBlocked('git_commit')).toBe(true);
    expect(isPlanBlocked('mcp:fs:read')).toBe(true);
    expect(isPlanBlocked('read_file')).toBe(false);
    expect(isPlanBlocked('git_status')).toBe(false);
    expect(isPlanBlocked('search_code')).toBe(false);
  });

  it('filters tools when plan enabled, keeps all when disabled', () => {
    const visible = planVisibleTools(ALL, true);
    expect(visible).toContain('read_file');
    expect(visible).toContain('search_code');
    expect(visible).not.toContain('write_file');
    expect(visible).not.toContain('run_shell');
    expect(planVisibleTools(ALL, false)).toHaveLength(ALL.length);
  });
});
