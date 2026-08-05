import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { OfficePage } from './OfficePage';

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
  (window as unknown as { jarvis: unknown }).jarvis = {
    invoke: async (m: string) => {
      if (m === 'templates.list') return [{ id: 't1', name: 'review', content: 'Review {{name}}' }];
      if (m === 'office.file.analyze') return { ok: true, result: '分析结果' };
      return [];
    },
    settingsGet: async () => [],
    settingsSet: async () => {},
    onDidReceive: () => () => {}
  };
});

afterEach(() => { cleanup(); });

describe('OfficePage', () => {
  it('renders the office aggregate with the writing view mounted by default', async () => {
    render(<OfficePage />);
    expect(screen.getByTestId('office-page')).toBeTruthy();
    // Writing tab is the default; SelectionMenu is NOT remounted here.
    expect(screen.getByTestId('writing-view')).toBeTruthy();
    expect(screen.queryByTestId('selection-menu')).toBeNull();
  });

  it('switches to the search-providers tab', async () => {
    render(<OfficePage />);
    fireEvent.click(screen.getByTestId('office-tab-search'));
    await waitFor(() => expect(screen.getByTestId('search-providers')).toBeTruthy());
  });

  it('routes a template insert into the shared composer', async () => {
    render(<OfficePage />);
    fireEvent.click(screen.getByTestId('office-tab-templates'));
    await waitFor(() => expect(screen.getByTestId('tpl-insert-t1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('tpl-insert-t1'));
    // The insert landed in local composer state; switch tabs to read it.
    fireEvent.click(screen.getByTestId('office-tab-composer'));
    await waitFor(() => expect((screen.getByTestId('office-composer') as HTMLTextAreaElement).value).toBe('Review Jarvis'));
  });

  // M5 final review — the five capabilities each need a runnable renderer entry.
  it('mounts the web-view summary entry (D8/I8)', async () => {
    render(<OfficePage />);
    fireEvent.click(screen.getByTestId('office-tab-web'));
    await waitFor(() => expect(screen.getByTestId('webview-summary')).toBeTruthy());
  });

  it('mounts the video summary entry (D9)', async () => {
    render(<OfficePage />);
    fireEvent.click(screen.getByTestId('office-tab-video'));
    await waitFor(() => expect(screen.getByTestId('video-summary')).toBeTruthy());
  });

  it('mounts the image generation entry (D10)', async () => {
    render(<OfficePage />);
    fireEvent.click(screen.getByTestId('office-tab-image'));
    await waitFor(() => expect(screen.getByTestId('image-generator')).toBeTruthy());
  });

  it('mounts the global search entry (L21)', async () => {
    render(<OfficePage />);
    fireEvent.click(screen.getByTestId('office-tab-globalsearch'));
    await waitFor(() => expect(screen.getByTestId('global-search')).toBeTruthy());
  });

  // M5 final review — D12 file analysis is the DropZone attach path: dropping a
  // doc on the writing tab must actually run office.file.analyze and show output.
  it('analyzes a dropped docx via office.file.analyze and shows the result', async () => {
    render(<OfficePage />);
    const zone = screen.getByTestId('drop-zone');
    fireEvent.drop(zone, { dataTransfer: { files: [{ name: 'report.docx', path: '/tmp/report.docx' }] } });
    await waitFor(() => expect(screen.getByTestId('office-analysis')).toBeTruthy());
    expect(screen.getByTestId('office-analysis-0').textContent).toContain('report.docx');
    expect(screen.getByTestId('office-analysis-0').textContent).toContain('分析结果');
  });

  it('surfaces a per-file analyze error inline', async () => {
    const invoke = vi.fn(async (m: string) => {
      if (m === 'office.file.analyze') return { ok: false, error: 'boom' };
      return [];
    });
    (window as unknown as { jarvis: unknown }).jarvis = { invoke, settingsGet: async () => [], settingsSet: async () => {}, onDidReceive: () => () => {} };
    render(<OfficePage />);
    const zone = screen.getByTestId('drop-zone');
    fireEvent.drop(zone, { dataTransfer: { files: [{ name: 'broken.docx', path: '/tmp/broken.docx' }] } });
    await waitFor(() => expect(screen.getByTestId('office-analysis')).toBeTruthy());
    expect(screen.getByTestId('office-analysis-0').textContent).toContain('boom');
  });
});
