import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { VersionHistoryPage } from './VersionHistoryPage';

beforeAll(async () => {
  // Same i18n init as sibling specs (ApprovalPanel.spec/DiffPanel.spec) so
  // useTranslation resolves the versionHistory.* keys without noise.
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
});

afterEach(() => { cleanup(); });

describe('VersionHistoryPage', () => {
  const oneVersion = [{ id: 'v1', createdAt: '2026-01-01T00:00:00.000Z', fields: ['name', 'systemPrompt'] }];

  it('lists versions and rolls back through agents.rollback with a { id, versionId } object', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'agents.versions') return { ok: true, versions: oneVersion };
      return { ok: true };
    });
    (window as unknown as { jarvis: unknown }).jarvis = { invoke, onDidReceive: () => () => {} };
    render(<VersionHistoryPage agentId="a1" />);

    // Initial load resolves async through the agents.versions { id } object.
    expect(await screen.findByTestId('rollback-v1')).toBeTruthy();
    expect(screen.getByText(/2026-01-01T00:00:00.000Z/)).toBeTruthy();
    expect(screen.getByText(/name, systemPrompt/)).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('agents.versions', { id: 'a1' });

    fireEvent.click(screen.getByTestId('rollback-v1'));
    // The main agents.rollback handler destructures a single { id, versionId }
    // arg (the preload spreads positional args), so the invoke must carry an
    // object — a two-arg call would silently no-op.
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('agents.rollback', { id: 'a1', versionId: 'v1' }));
    expect((await screen.findByTestId('version-diff')).textContent).toContain('已回滚');
  });

  it('surfaces a failed rollback and keeps the list intact', async () => {
    const invoke = vi.fn(async (channel: string, args: unknown) => {
      if (channel === 'agents.versions') return { ok: true, versions: oneVersion };
      // Rollback fails -> { ok:false, error } must be surfaced, not thrown.
      if (channel === 'agents.rollback') return { ok: false, error: 'version v1 not found for agent a1' };
      return args;
    });
    (window as unknown as { jarvis: unknown }).jarvis = { invoke, onDidReceive: () => () => {} };
    render(<VersionHistoryPage agentId="a1" />);
    expect(await screen.findByTestId('rollback-v1')).toBeTruthy();

    fireEvent.click(screen.getByTestId('rollback-v1'));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('agents.rollback', { id: 'a1', versionId: 'v1' }));
    // The error is shown and the list is not cleared.
    expect((await screen.findByTestId('version-error')).textContent).toContain('version v1 not found for agent a1');
    expect(screen.getByTestId('rollback-v1')).toBeTruthy();
    // No rolled-back confirmation on a failed rollback.
    expect(screen.getByTestId('version-diff').textContent).toBe('');
  });

  it('surfaces an invoke rejection (no unhandled promise rejection)', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'agents.versions') throw new Error('ipc down');
      return { ok: true };
    });
    (window as unknown as { jarvis: unknown }).jarvis = { invoke, onDidReceive: () => () => {} };
    render(<VersionHistoryPage agentId="a1" />);
    expect((await screen.findByTestId('version-error')).textContent).toContain('ipc down');
  });
});
