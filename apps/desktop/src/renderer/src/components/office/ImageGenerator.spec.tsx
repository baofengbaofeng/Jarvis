import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { ImageGenerator } from './ImageGenerator';

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
});

afterEach(() => { cleanup(); });

describe('ImageGenerator', () => {
  it('invokes office.image.generate with prompt + size and renders thumbnails', async () => {
    const invoke = vi.fn(async () => ({ ok: true, urls: [{ url: 'https://img/x.png' }, { url: 'https://img/y.png' }] }));
    (window as unknown as { jarvis: unknown }).jarvis = { invoke, onDidReceive: () => () => {} };
    render(<ImageGenerator />);
    fireEvent.change(screen.getByTestId('image-prompt'), { target: { value: 'a cat' } });
    fireEvent.change(screen.getByTestId('image-size'), { target: { value: '512x512' } });
    fireEvent.click(screen.getByTestId('image-generate'));
    expect(invoke).toHaveBeenCalledWith('office.image.generate', { prompt: 'a cat', size: '512x512' });
    const result = await screen.findByTestId('image-result');
    expect(result.querySelectorAll('img')).toHaveLength(2);
  });

  it('surfaces the no-image-API-key error inline (D10 no-silent-failure)', async () => {
    const invoke = vi.fn(async () => ({ ok: false, error: '未配置图像生成 API Key(见设置→办公→图像)。' }));
    (window as unknown as { jarvis: unknown }).jarvis = { invoke, onDidReceive: () => () => {} };
    render(<ImageGenerator />);
    fireEvent.change(screen.getByTestId('image-prompt'), { target: { value: 'a dog' } });
    fireEvent.click(screen.getByTestId('image-generate'));
    expect(await screen.findByTestId('image-error')).toBeTruthy();
    expect(screen.getByTestId('image-error').textContent).toContain('API Key');
  });
});
