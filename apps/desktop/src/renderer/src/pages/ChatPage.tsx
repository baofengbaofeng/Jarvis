import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@jarvis/ui';
import { useChatStore } from '../stores/chat-store';
import { MessageBubble } from '../components/chat/MessageBubble';
import { ChatInput } from '../components/chat/ChatInput';
import { ChatStepList } from '../components/chat/ChatStepList';
import { MarkdownView } from '../components/chat/MarkdownView';
import { PlanModeBadge } from '../components/coding/PlanModeBadge';
import { useAgentStore } from '../stores/agent-store';

export function ChatPage() {
  const { t } = useTranslation('common');
  const { messages, streamingText, steps, init } = useChatStore();
  const currentAgent = useAgentStore((s) => s.current);
  const isEmpty = messages.length === 0 && !streamingText && steps.length === 0;

  useEffect(() => { void init(); }, [init]);

  return (
    <div
      data-testid="chat-page"
      className={`chat-page${isEmpty ? ' chat-page--empty' : ' chat-page--active'}`}
    >
      <div className="chat-page__context" data-testid="chat-context">
        <span>{currentAgent?.name ?? t('shell.navChat')}</span>
        {currentAgent?.workspaceId ? <span className="chat-page__context-sep">·</span> : null}
        {currentAgent?.workspaceId ? <span className="chat-page__context-muted">{currentAgent.workspaceId}</span> : null}
        <PlanModeBadge active={Boolean(currentAgent?.planOnly)} />
        {currentAgent?.modelId != null && <Badge variant="default">{currentAgent.modelId}</Badge>}
      </div>

      {isEmpty ? (
        <div className="chat-page__empty" data-testid="chat-empty-composer">
          <ChatInput />
        </div>
      ) : (
        <>
          <div className="chat-page__messages">
            <div className="chat-page__stream">
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
          <div className="chat-page__composer">
            <ChatInput />
          </div>
        </>
      )}
    </div>
  );
}
