import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import i18n from 'i18next';
import { getResources } from '@jarvis/i18n';
import { AuditLogView } from './AuditLogView';

const entries = [
  { ts: '2026-08-05T00:00:00Z', kind: 'tool_call', actor: 'agent', action: 'read_file', target: 'a.txt', result: 'ok' },
  { ts: '2026-08-05T00:00:01Z', kind: 'approval', actor: 'agent', action: 'git_commit', result: 'denied' },
];
const invoke = vi.fn(async (m: string, args?: { kind?: string }) => {
  if (m === 'audit.list') return args?.kind ? entries.filter(e => e.kind === args.kind) : entries;
  return undefined;
});

describe('AuditLogView', () => {
  beforeAll(async () => {
    // The component translates via useTranslation('common'); init the real
    // resource bundle so t() resolves instead of returning raw keys.
    await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
  });
  beforeEach(() => { (window as any).jarvis = { invoke }; });
  afterEach(() => { cleanup(); });

  it('renders audit rows from audit.list', async () => {
    render(<I18nextProvider i18n={i18n}><AuditLogView /></I18nextProvider>);
    await waitFor(() => expect(screen.getAllByTestId('audit-row')).toHaveLength(2));
    expect(screen.getByText('read_file')).toBeTruthy();
    expect(screen.getByText('git_commit')).toBeTruthy();
    expect(screen.getByText('denied')).toBeTruthy();
  });

  it('reloads audit.list with the kind filter when the select changes', async () => {
    render(<I18nextProvider i18n={i18n}><AuditLogView /></I18nextProvider>);
    await waitFor(() => expect(screen.getAllByTestId('audit-row')).toHaveLength(2));
    fireEvent.change(screen.getByTestId('audit-kind'), { target: { value: 'tool_call' } });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('audit.list', { kind: 'tool_call' }));
    await waitFor(() => expect(screen.getAllByTestId('audit-row')).toHaveLength(1));
    expect(screen.getByText('read_file')).toBeTruthy();
  });

  it('exports CSV via audit.export then dialog.saveText', async () => {
    render(<I18nextProvider i18n={i18n}><AuditLogView /></I18nextProvider>);
    await waitFor(() => expect(screen.getAllByTestId('audit-row')).toHaveLength(2));
    fireEvent.click(screen.getByText(/CSV/));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('audit.export', { format: 'csv' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('dialog.saveText', expect.objectContaining({ defaultName: 'audit.csv' })));
  });
});
