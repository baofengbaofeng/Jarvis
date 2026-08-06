import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { ConfigImportExportView } from './ConfigImportExportView';

const invoke = vi.fn(async (m: string) => {
  if (m === 'config.export') return '{"schemaVersion":11}';
  if (m === 'dialog.saveText') return { ok: true };
  if (m === 'dialog.pickPath') return [{ token: 'cap-config', name: 'jarvis-config.json', kind: 'file', sizeBytes: 1, expiresAt: 1 }];
  if (m === 'config.readPickedFile') return '{"schemaVersion":11,"providers":[],"models":[],"agents":[],"settings":{}}';
  if (m === 'config.import') return { ok: true, created: 1, updated: 0, skipped: 0 };
  return undefined;
});

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
});

beforeEach(() => {
  (window as any).jarvis = { invoke };
  invoke.mockClear();
});

afterEach(() => { cleanup(); });

describe('ConfigImportExportView', () => {
  it('exports JSON via config.export then dialog.saveText', async () => {
    render(<ConfigImportExportView />);
    fireEvent.click(screen.getByTestId('export-json'));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('config.export', 'json'));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('dialog.saveText', { defaultName: 'jarvis-config.json', content: '{"schemaVersion":11}' }));
  });

  it('exports YAML via config.export then dialog.saveText', async () => {
    render(<ConfigImportExportView />);
    fireEvent.click(screen.getByTestId('export-yaml'));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('config.export', 'yaml'));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('dialog.saveText', { defaultName: 'jarvis-config.yaml', content: '{"schemaVersion":11}' }));
  });

  it('imports a file with the chosen strategy', async () => {
    render(<ConfigImportExportView />);
    fireEvent.change(screen.getByTestId('strategy'), { target: { value: 'merge' } });
    fireEvent.click(screen.getByTestId('import'));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('dialog.pickPath', { purpose: 'config-import' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('config.readPickedFile', { capability: 'cap-config' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      'config.import',
      '{"schemaVersion":11,"providers":[],"models":[],"agents":[],"settings":{}}',
      'merge',
    ));
    await waitFor(() => expect(screen.getByTestId('transfer-msg')).toBeTruthy());
  });

  it('no-ops on import when the file picker is canceled', async () => {
    invoke.mockImplementationOnce(async (m: string) => (m === 'dialog.pickPath' ? [] : undefined));
    render(<ConfigImportExportView />);
    fireEvent.click(screen.getByTestId('import'));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('dialog.pickPath', { purpose: 'config-import' }));
    expect(invoke).not.toHaveBeenCalledWith('config.readPickedFile', expect.anything());
  });
});
