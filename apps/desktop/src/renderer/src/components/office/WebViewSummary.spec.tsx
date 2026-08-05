import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { WebViewSummary } from './WebViewSummary';

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
});

afterEach(() => { cleanup(); });

describe('WebViewSummary', () => {
  it('invokes office.webview.summarize and renders the result', async () => {
    const invoke = vi.fn(async () => ({ ok: true, result: '网页要点' }));
    (window as unknown as { jarvis: unknown }).jarvis = { invoke, onDidReceive: () => () => {} };
    render(<WebViewSummary />);
    fireEvent.change(screen.getByTestId('webview-url'), { target: { value: 'https://example.com/a' } });
    fireEvent.click(screen.getByTestId('webview-summarize'));
    expect(invoke).toHaveBeenCalledWith('office.webview.summarize', 'https://example.com/a');
    expect(await screen.findByTestId('webview-result')).toBeTruthy();
    expect(screen.getByTestId('webview-result').textContent).toBe('网页要点');
  });

  it('surfaces a non-ok response inline', async () => {
    const invoke = vi.fn(async () => ({ ok: false, error: '页面无可提取的正文内容' }));
    (window as unknown as { jarvis: unknown }).jarvis = { invoke, onDidReceive: () => () => {} };
    render(<WebViewSummary />);
    fireEvent.change(screen.getByTestId('webview-url'), { target: { value: 'https://example.com/b' } });
    fireEvent.click(screen.getByTestId('webview-summarize'));
    expect(await screen.findByTestId('webview-error')).toBeTruthy();
    expect(screen.getByTestId('webview-error').textContent).toBe('页面无可提取的正文内容');
  });
});
