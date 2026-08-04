import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../stores/chat-store';
import { MessageBubble } from '../components/chat/MessageBubble';
import { ChatInput } from '../components/chat/ChatInput';
import { MarkdownView } from '../components/chat/MarkdownView';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

export function ChatPage() {
  const { t } = useTranslation('common');
  const { messages, streamingText, init } = useChatStore();

  useEffect(() => { void init(); }, [init]);

  return (
    <div data-testid="chat-page" style={{ display: 'flex', height: '100vh' }}>
      <aside style={{ width: 220, borderRight: '1px solid var(--border)', padding: 8 }}>
        <button data-testid="chat-new" onClick={() => void useChatStore.getState().newSession()}>+</button>
        <button data-testid="chat-to-settings" onClick={() => (window.location.href = '/settings')}>{t('settings.title')}</button>
        <LanguageSwitcher />
      </aside>
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {messages.map(m => <MessageBubble key={m.id} message={m} />)}
          {streamingText && <div data-testid="streaming-text"><MarkdownView content={streamingText} /></div>}
        </div>
        <ChatInput />
      </main>
    </div>
  );
}
