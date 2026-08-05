import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { DataSafetyPage } from './DataSafetyPage';

const invoke = vi.fn(async (m: string) => {
  if (m === 'backup.list') return [];
  if (m === 'wipe.run') return { deleted: {}, keychainDeleted: 0, workspaceRemoved: false, vacuumed: true };
  return undefined;
});
const settingsSet = vi.fn(async () => {});

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
});

beforeEach(() => { (window as any).jarvis = { invoke, settingsSet }; });

afterEach(() => { cleanup(); });

describe('DataSafetyPage', () => {
  it('shows the backup pane by default with both tab buttons', async () => {
    render(<DataSafetyPage />);
    await waitFor(() => expect(screen.getByTestId('backup-pane')).toBeTruthy());
    expect(screen.getByTestId('safety-tab-backup')).toBeTruthy();
    expect(screen.getByTestId('safety-tab-wipe')).toBeTruthy();
    expect(screen.getByTestId('local-only')).toBeTruthy();
  });

  it('switches to the wipe tab and back', async () => {
    render(<DataSafetyPage />);
    await waitFor(() => expect(screen.getByTestId('backup-pane')).toBeTruthy());
    fireEvent.click(screen.getByTestId('safety-tab-wipe'));
    await waitFor(() => expect(screen.getByTestId('wipe-pane')).toBeTruthy());
    expect(screen.queryByTestId('backup-pane')).toBeNull();
    fireEvent.click(screen.getByTestId('safety-tab-backup'));
    await waitFor(() => expect(screen.getByTestId('backup-pane')).toBeTruthy());
  });

  it('persists the J4 local-only toggle through settings.set', async () => {
    render(<DataSafetyPage />);
    await waitFor(() => expect(screen.getByTestId('local-only')).toBeTruthy());
    fireEvent.click(screen.getByTestId('local-only'));
    await waitFor(() => expect(settingsSet).toHaveBeenCalledWith('data_policy', { local_only: true }));
  });
});
