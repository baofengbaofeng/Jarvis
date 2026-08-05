import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { BackupPane } from './BackupPane';

const invoke = vi.fn(async (m: string) => {
  if (m === 'backup.list') return [{ file: '/tmp/jarvis/backups/20260805.db', name: '20260805.db', sizeBytes: 2048, createdAt: '2026-08-05T00:00:00Z' }];
  if (m === 'backup.create') return { file: '/tmp/jarvis/backups/new.db' };
  if (m === 'backup.restore') return { ok: true, restart: true };
  return undefined;
});

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
});

beforeEach(() => { (window as any).jarvis = { invoke }; });

afterEach(() => { cleanup(); });

describe('BackupPane', () => {
  it('renders the backup list from backup.list', async () => {
    render(<BackupPane />);
    await waitFor(() => expect(screen.getByTestId('backup-item')).toBeTruthy());
    expect(screen.getByText(/20260805\.db/)).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('backup.list');
  });

  it('calls backup.create on backup-now click and refreshes', async () => {
    render(<BackupPane />);
    await waitFor(() => expect(screen.getByTestId('backup-now')).toBeTruthy());
    fireEvent.click(screen.getByTestId('backup-now'));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('backup.create'));
  });
});
