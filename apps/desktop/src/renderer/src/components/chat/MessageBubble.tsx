import type { ChatMessage } from '@jarvis/protocol';
import { MarkdownView } from './MarkdownView';

export function MessageBubble({ message }: { message: ChatMessage }) {
  // L23: content may be a plain string or a content array (text + image_url
  // parts). The NUL-marker serialized form is always deserialized before it
  // reaches the renderer (ChatService.loadMessages), so it is never shown here.
  const parts = typeof message.content === 'string'
    ? [{ type: 'text' as const, text: message.content }]
    : message.content;
  const text = parts.filter(p => p.type === 'text').map(p => p.text).join('\n');
  const images = parts.filter((p): p is { type: 'image_url'; image_url: { url: string } } => p.type === 'image_url');
  return (
    <div data-testid={`message-${message.role}`} style={{ textAlign: message.role === 'user' ? 'right' : 'left', padding: 8 }}>
      {message.role === 'user' ? (
        <span>
          {text && <span>{text}</span>}
          {images.map((p, i) => (
            <img key={i} data-testid="message-image" src={p.image_url.url} alt="attachment" width={120} style={{ display: 'block', marginTop: 4 }} />
          ))}
        </span>
      ) : (
        <MarkdownView content={text} />
      )}
    </div>
  );
}
