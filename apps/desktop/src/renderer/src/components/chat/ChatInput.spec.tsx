import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { getResources } from '@jarvis/i18n';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { ChatInput } from './ChatInput';
import { useChatStore } from '../../stores/chat-store';

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
});

beforeEach(() => {
  useChatStore.setState({ sessionId: null, sessions: [], messages: [], streaming: false, streamingText: '', pendingImages: [] });
});

afterEach(() => {
  cleanup();
});

describe('ChatInput', () => {
  it('keeps the text portion of a mixed text+image paste', () => {
    render(<ChatInput />);
    const textarea = screen.getByTestId('chat-input') as HTMLTextAreaElement;
    const imgFile = new File(['fake'], 'a.png', { type: 'image/png' });
    fireEvent.paste(textarea, {
      clipboardData: { files: [imgFile], getData: (type: string) => (type === 'text' ? 'pasted words' : '') }
    });
    // The plain-text portion of a mixed clipboard survives the preventDefault.
    expect(textarea.value).toContain('pasted words');
  });

  it('queues pasted images into the store and renders previews', async () => {
    render(<ChatInput />);
    const textarea = screen.getByTestId('chat-input') as HTMLTextAreaElement;
    const imgFile = new File(['fake'], 'a.png', { type: 'image/png' });
    fireEvent.paste(textarea, {
      clipboardData: { files: [imgFile], getData: () => '' }
    });
    // jsdom FileReader is async; the preview appears once readAsDataURL resolves.
    await waitFor(() => expect(screen.getByTestId('pending-images')).toBeTruthy());
    expect(useChatStore.getState().pendingImages.length).toBeGreaterThan(0);
  });

  it('updates textarea value on change', () => {
    render(<ChatInput />);
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'hello' } });
    expect((screen.getByTestId('chat-input') as HTMLTextAreaElement).value).toBe('hello');
  });

  it('allows an image-only send without typing text', () => {
    useChatStore.setState({ pendingImages: ['data:image/png;base64,AAA'] });
    const send = vi.fn();
    useChatStore.setState({ send: send as unknown as (text: string) => Promise<void> });
    render(<ChatInput />);
    fireEvent.click(screen.getByTestId('chat-send'));
    expect(send).toHaveBeenCalled();
  });
});
