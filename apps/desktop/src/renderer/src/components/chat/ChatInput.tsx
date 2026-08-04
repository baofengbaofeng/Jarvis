import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MentionCandidate } from '@jarvis/core';
import { useChatStore } from '../../stores/chat-store';
import { MentionPicker } from '../coding/MentionPicker';

// E6: opening the @-mention picker. The picker is shown while the current input
// ends with a `@query` token (word boundary or line start), and selecting a
// candidate replaces that trailing token with the candidate's label so the core
// @mention parser can resolve it on send.
const TRAILING_AT = /(?:^|\s)@([^\s@#]*)$/;

export function ChatInput() {
  const { t } = useTranslation('common');
  const [text, setText] = useState('');
  const [mentionOpen, setMentionOpen] = useState(false);
  const send = useChatStore((s) => s.send);
  const streaming = useChatStore((s) => s.streaming);

  const submit = () => {
    const value = text.trim();
    if (!value) return;
    setText('');
    setMentionOpen(false);
    void send(value);
  };

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setText(value);
    setMentionOpen(TRAILING_AT.test(value));
  };

  const selectMention = (c: MentionCandidate) => {
    setText((prev) => prev.replace(TRAILING_AT, (m, q) => m.slice(0, m.length - q.length) + c.label));
    setMentionOpen(false);
  };

  return (
    <div>
      {mentionOpen && <MentionPicker onSelect={selectMention} onClose={() => setMentionOpen(false)} />}
      <div style={{ display: 'flex', gap: 8 }}>
        <textarea
          data-testid="chat-input"
          placeholder={t('chat.placeholder')}
          value={text}
          onChange={onChange}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
          style={{ flex: 1 }}
        />
        <button data-testid="chat-send" onClick={submit} disabled={streaming}>{t('common.ok')}</button>
      </div>
    </div>
  );
}
