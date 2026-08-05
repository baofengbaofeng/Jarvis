import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { ChatMessage } from '@jarvis/protocol';
import { MessageBubble } from './MessageBubble';

// No i18n init needed — MessageBubble renders no strings. vitest globals are
// off, so @testing-library/react does not auto-cleanup; unmount after every
// test like the sibling component specs.
afterEach(cleanup);

function msg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return { id: 'm1', sessionId: 's1', role: 'user', content: '', createdAt: '', ...overrides };
}

describe('MessageBubble', () => {
  it('renders a plain string user message as text', () => {
    render(<MessageBubble message={msg({ role: 'user', content: 'hello' })} />);
    expect(screen.getByText('hello')).toBeTruthy();
  });

  it('renders an assistant string message through markdown', () => {
    render(<MessageBubble message={msg({ role: 'assistant', content: '**bold** reply' })} />);
    expect(screen.getByText('bold')).toBeTruthy();
    expect(screen.getByText('reply')).toBeTruthy();
  });

  it('renders a content array (text + image) without leaking the marker or JSON', () => {
    const content = [
      { type: 'text' as const, text: 'see this' },
      { type: 'image_url' as const, image_url: { url: 'data:image/png;base64,AAA' } }
    ];
    render(<MessageBubble message={msg({ role: 'user', content })} />);
    expect(screen.getByText('see this')).toBeTruthy();
    const img = screen.getByTestId('message-image') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('data:image/png;base64,AAA');
    // The NUL-marker serialized form must never be shown to the user.
    const bodyText = document.body.textContent ?? '';
    expect(bodyText).not.toContain('jarvis:content');
    expect(bodyText).not.toContain('"type":"text"');
    expect(bodyText).not.toContain('[object Object]');
  });
});
