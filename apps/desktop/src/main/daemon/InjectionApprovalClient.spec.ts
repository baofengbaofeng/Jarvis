import { describe, expect, it, vi } from 'vitest';
import { InjectionApprovalClient } from './InjectionApprovalClient';

describe('InjectionApprovalClient', () => {
  it('lists pending approvals with bearer auth and DTO-only fields', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [
        { kind: 'mcp', name: 'fs', digest: 'abc', taskId: 't1', createdAt: '2026-01-01T00:00:00Z', env: 'SECRET', args: ['--password'] },
      ],
      text: async () => '',
    }));
    const client = new InjectionApprovalClient('http://127.0.0.1:17890', 'secret', fetchImpl);
    const items = await client.list();
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:17890/v1/runtime/injection-approvals',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
      }),
    );
    expect(items).toEqual([
      { kind: 'mcp', name: 'fs', digest: 'abc', taskId: 't1', createdAt: '2026-01-01T00:00:00Z' },
    ]);
    expect(JSON.stringify(items)).not.toContain('SECRET');
    expect(JSON.stringify(items)).not.toContain('--password');
  });

  it('approves exact kind/name/digest without auto-retry payload', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 204,
      json: async () => ({}),
      text: async () => '',
    }));
    const client = new InjectionApprovalClient('http://127.0.0.1:17890', 'secret', fetchImpl);
    await client.approve({ kind: 'mcp', name: 'fs', digest: 'abc' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:17890/v1/runtime/injection-approvals/abc',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
        body: JSON.stringify({ kind: 'mcp', name: 'fs' }),
      }),
    );
  });

  it('rejects unauthenticated failures with stable status', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ code: 'UNAUTHORIZED' }),
      text: async () => '',
    }));
    const client = new InjectionApprovalClient('http://127.0.0.1:17890', '', fetchImpl);
    await expect(client.list()).rejects.toMatchObject({ status: 401 });
  });
});
