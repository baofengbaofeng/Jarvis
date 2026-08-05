import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { VideoSummary } from './VideoSummary';

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
});

afterEach(() => { cleanup(); });

describe('VideoSummary', () => {
  it('invokes office.video.summarize and renders the result', async () => {
    const invoke = vi.fn(async () => ({ ok: true, result: '视频要点' }));
    (window as unknown as { jarvis: unknown }).jarvis = { invoke, onDidReceive: () => () => {} };
    render(<VideoSummary />);
    fireEvent.change(screen.getByTestId('video-url'), { target: { value: 'https://youtu.be/abc123' } });
    fireEvent.click(screen.getByTestId('video-summarize'));
    expect(invoke).toHaveBeenCalledWith('office.video.summarize', 'https://youtu.be/abc123');
    expect(await screen.findByTestId('video-result')).toBeTruthy();
  });

  it('surfaces the clear no-transcript error inline (correct D9 behavior)', async () => {
    const invoke = vi.fn(async () => ({ ok: false, error: '未配置 transcript API/Whisper,无法获取视频字幕' }));
    (window as unknown as { jarvis: unknown }).jarvis = { invoke, onDidReceive: () => () => {} };
    render(<VideoSummary />);
    fireEvent.change(screen.getByTestId('video-url'), { target: { value: 'https://youtu.be/xyz789' } });
    fireEvent.click(screen.getByTestId('video-summarize'));
    expect(await screen.findByTestId('video-error')).toBeTruthy();
    expect(screen.getByTestId('video-error').textContent).toContain('transcript');
  });
});
