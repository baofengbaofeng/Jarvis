import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../stores/chat-store';
import { MessageBubble } from '../components/chat/MessageBubble';
import { ChatInput } from '../components/chat/ChatInput';
import { MarkdownView } from '../components/chat/MarkdownView';
import { PlanModeBadge } from '../components/coding/PlanModeBadge';
import { useAgentStore } from '../stores/agent-store';

export function ChatPage() {
  const { t } = useTranslation('common');
  const { messages, streamingText, sessions, sessionId, init } = useChatStore();
  const currentAgent = useAgentStore((s) => s.current);

  useEffect(() => { void init(); }, [init]);

  return (
    <div data-testid="chat-page" style={{ display: 'flex', height: '100%' }}>
      <aside style={{ width: 220, borderRight: '1px solid var(--border)', padding: 8 }}>
        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
          <button data-testid="chat-new" title={t('chat.newSession')} onClick={() => void useChatStore.getState().newSession()}>+</button>
        </div>
        <h3 data-testid="chat-sessions-title" style={{ margin: '12px 0 4px', fontSize: 12 }}>{t('chat.sessions')}</h3>
        <ul data-testid="chat-sessions" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {sessions.map((s) => (
            <li key={s.id} style={{ marginBottom: 4 }}>
              <button
                data-testid={`chat-session-${s.id}`}
                onClick={() => void useChatStore.getState().loadSession(s.id)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '4px 8px',
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: s.id === sessionId ? 600 : 400,
                  background: s.id === sessionId ? 'var(--border, #ddd)' : 'transparent'
                }}
              >
                {s.title || s.id}
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '4px 8px', borderBottom: '1px solid var(--border, #eee)' }}>
          <PlanModeBadge active={Boolean(currentAgent?.planOnly)} />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {messages.map(m => <MessageBubble key={m.id} message={m} />)}
          {streamingText && <div data-testid="streaming-text"><MarkdownView content={streamingText} /></div>}
        </div>
        <ChatInput />
      </main>
    </div>
  );
}
