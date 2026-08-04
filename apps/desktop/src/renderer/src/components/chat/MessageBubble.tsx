import type { ChatMessage } from '@jarvis/protocol';
import { MarkdownView } from './MarkdownView';

export function MessageBubble({ message }: { message: ChatMessage }) {
  return (
    <div data-testid={`message-${message.role}`} style={{ textAlign: message.role === 'user' ? 'right' : 'left', padding: 8 }}>
      {message.role === 'user' ? <span>{message.content}</span> : <MarkdownView content={message.content} />}
    </div>
  );
}
