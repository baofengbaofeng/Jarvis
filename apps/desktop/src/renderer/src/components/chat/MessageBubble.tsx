import type { ChatMessage } from '@jarvis/protocol';
import { MessageBubble as UiMessageBubble } from '@jarvis/ui';
import { MarkdownView } from './MarkdownView';

export function MessageBubble({ message }: { message: ChatMessage }) {
  const parts = typeof message.content === 'string'
    ? [{ type: 'text' as const, text: message.content }]
    : message.content;
  const text = parts.filter(p => p.type === 'text').map(p => p.text).join('\n');
  const images = parts.filter((p): p is { type: 'image_url'; image_url: { url: string } } => p.type === 'image_url');

  return (
    <UiMessageBubble role={message.role === 'user' ? 'user' : 'assistant'}>
      <div data-testid={`message-${message.role}`}>
        {message.role === 'user' ? (
          <span>
            {text && <span>{text}</span>}
            {images.map((p, i) => (
              <img key={i} data-testid="message-image" src={p.image_url.url} alt="attachment" />
            ))}
          </span>
        ) : (
          <MarkdownView content={text} />
        )}
      </div>
    </UiMessageBubble>
  );
}
