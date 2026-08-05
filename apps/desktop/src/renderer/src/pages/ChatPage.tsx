import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../stores/chat-store';
import { MessageBubble } from '../components/chat/MessageBubble';
import { ChatInput } from '../components/chat/ChatInput';
import { MarkdownView } from '../components/chat/MarkdownView';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { AgentSwitcher } from '../components/agents/AgentSwitcher';
import { TaskControlBar } from '../components/tasks/TaskControlBar';
import { PlanModeBadge } from '../components/coding/PlanModeBadge';
import { useAgentStore } from '../stores/agent-store';

export function ChatPage() {
  const { t } = useTranslation('common');
  const { messages, streamingText, sessions, sessionId, init } = useChatStore();
  const currentAgent = useAgentStore((s) => s.current);

  useEffect(() => { void init(); }, [init]);

  return (
    <div data-testid="chat-page" style={{ display: 'flex', height: '100vh' }}>
      <aside style={{ width: 220, borderRight: '1px solid var(--border)', padding: 8 }}>
        <AgentSwitcher />
        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
          <button data-testid="chat-new" title={t('chat.newSession')} onClick={() => void useChatStore.getState().newSession()}>+</button>
          <button data-testid="chat-to-coding" onClick={() => (window.location.href = '/coding')}>{t('menu.coding')}</button>
          <button data-testid="chat-to-office" onClick={() => (window.location.href = '/office')}>{t('menu.office')}</button>
          <button data-testid="chat-to-squad" onClick={() => (window.location.href = '/squad')}>{t('menu.squad')}</button>
          <button data-testid="chat-to-canvas" onClick={() => (window.location.href = '/canvas')}>{t('canvas.title')}</button>
          {/* M8 final review: /board and /workflow had no nav entry (only /canvas
              got one) — add the same sidebar buttons so they are reachable. */}
          <button data-testid="chat-to-board" onClick={() => (window.location.href = '/board')}>{t('board.title')}</button>
          <button data-testid="chat-to-workflow" onClick={() => (window.location.href = '/workflow')}>{t('workflow.title')}</button>
          <button data-testid="chat-to-settings" onClick={() => (window.location.href = '/settings')}>{t('settings.title')}</button>
        </div>
        <LanguageSwitcher />
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
        <TaskControlBar />
      </main>
    </div>
  );
}
