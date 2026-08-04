import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../../stores/chat-store';

export function ChatInput() {
  const { t } = useTranslation('common');
  const [text, setText] = useState('');
  const send = useChatStore((s) => s.send);
  const streaming = useChatStore((s) => s.streaming);

  const submit = () => {
    const value = text.trim();
    if (!value) return;
    setText('');
    void send(value);
  };

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <textarea
        data-testid="chat-input"
        placeholder={t('chat.placeholder')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
        style={{ flex: 1 }}
      />
      <button data-testid="chat-send" onClick={submit} disabled={streaming}>{t('common.ok')}</button>
    </div>
  );
}
