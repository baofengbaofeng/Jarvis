import { describe, it, expect, vi } from 'vitest';
import { reportBootstrapFailure, runBootstrapSafe } from './bootstrapSafety';

describe('bootstrapSafety (DESK-03)', () => {
  it('reportBootstrapFailure shows an error dialog', () => {
    const show = vi.fn();
    reportBootstrapFailure(new Error('db locked'), show);
    expect(show).toHaveBeenCalledWith('JARVIS failed to start', 'db locked');
  });

  it('runBootstrapSafe reports and returns false when bootstrap throws', async () => {
    const report = vi.fn();
    const ok = await runBootstrapSafe(async () => {
      throw new Error('boom');
    }, report);
    expect(ok).toBe(false);
    expect(report).toHaveBeenCalled();
  });

  it('runBootstrapSafe returns true when bootstrap succeeds', async () => {
    const report = vi.fn();
    const ok = await runBootstrapSafe(async () => {}, report);
    expect(ok).toBe(true);
    expect(report).not.toHaveBeenCalled();
  });
});
