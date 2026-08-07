import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, EmptyState, PageHeader } from '@jarvis/ui';
import { useChatStore } from '../stores/chat-store';
import { MessageBubble } from '../components/chat/MessageBubble';
import { ChatInput } from '../components/chat/ChatInput';
import { ChatStepList } from '../components/chat/ChatStepList';
import { MarkdownView } from '../components/chat/MarkdownView';
import { PlanModeBadge } from '../components/coding/PlanModeBadge';
import { useAgentStore } from '../stores/agent-store';

export function ChatPage() {
  const { t } = useTranslation('common');
  const { messages, streamingText, steps, sessions, sessionId, init } = useChatStore();
  const currentAgent = useAgentStore((s) => s.current);

  useEffect(() => { void init(); }, [init]);

  return (
    <div data-testid="chat-page" className="chat-page">
      <aside className="chat-page__sidebar">
        <div className="chat-page__sidebar-header">
          <Button
            variant="primary"
            size="sm"
            data-testid="chat-new"
            title={t('chat.newSession')}
            onClick={() => void useChatStore.getState().newSession()}
          >
            + {t('chat.newSession')}
          </Button>
        </div>
        <h3 data-testid="chat-sessions-title" className="chat-page__sessions-title">{t('chat.sessions')}</h3>
        <ul data-testid="chat-sessions" className="chat-page__sessions">
          {sessions.map((s) => (
            <li key={s.id} className="chat-page__session">
              <button
                data-testid={`chat-session-${s.id}`}
                className={`chat-page__session-btn${s.id === sessionId ? ' chat-page__session-btn--active' : ''}`}
                onClick={() => void useChatStore.getState().loadSession(s.id)}
              >
                {s.title || s.id}
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <main className="chat-page__main">
        <PageHeader
          title={currentAgent?.name ?? t('shell.navChat')}
          subtitle={t('chat.subtitle')}
          badges={(
            <>
              <PlanModeBadge active={Boolean(currentAgent?.planOnly)} />
              {currentAgent?.modelId != null && <Badge variant="default">{currentAgent.modelId}</Badge>}
            </>
          )}
        />
        <div className="chat-page__messages">
          <div className="chat-page__stream">
            {messages.length === 0 && !streamingText && steps.length === 0 && (
              <EmptyState title={t('chat.welcome')} description={t('chat.welcomeHint')} />
            )}
            {messages.map(m => <MessageBubble key={m.id} message={m} />)}
            {(steps.length > 0 || streamingText) && (
              <div data-testid="chat-stream-active">
                <ChatStepList />
                {streamingText && (
                  <div data-testid="streaming-text" className="streaming-text">
                    <MarkdownView content={streamingText} />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <ChatInput />
      </main>
    </div>
  );
}
