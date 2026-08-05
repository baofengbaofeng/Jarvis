import { useState, type ClipboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { MentionCandidate } from '@jarvis/core';
import { useChatStore } from '../../stores/chat-store';
import { MentionPicker } from '../coding/MentionPicker';
import { ImageAttachment } from '../office/ImageAttachment';

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
  const pendingImages = useChatStore((s) => s.pendingImages);

  const submit = () => {
    const value = text.trim();
    // An image-only paste is a valid send: no text, but pendingImages non-empty.
    if (!value && pendingImages.length === 0) return;
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

  // L23: pasted image files become data-URL previews queued in the chat store;
  // they are sent as content parts on the next submit (toContentArray in send).
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const images = [...e.clipboardData.files].filter(f => f.type.startsWith('image/'));
    if (!images.length) return;
    e.preventDefault();
    // A mixed clipboard (text + image) would lose the text portion to the
    // default paste once we preventDefault; insert it explicitly so both survive.
    const pastedText = e.clipboardData.getData('text');
    if (pastedText) setText(prev => prev + pastedText);
    const addImages = useChatStore.getState().addImages;
    for (const f of images) {
      const reader = new FileReader();
      reader.onload = () => { if (typeof reader.result === 'string') addImages([reader.result]); };
      reader.readAsDataURL(f);
    }
  };

  const removeImage = (url: string) => useChatStore.getState().removeImage(url);

  return (
    <div>
      {mentionOpen && <MentionPicker onSelect={selectMention} onClose={() => setMentionOpen(false)} />}
      {pendingImages.length > 0 && (
        <div data-testid="pending-images">
          {pendingImages.map((src) => <ImageAttachment key={src} src={src} onRemove={removeImage} />)}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <textarea
          data-testid="chat-input"
          placeholder={t('chat.placeholder')}
          value={text}
          onChange={onChange}
          onPaste={onPaste}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
          style={{ flex: 1 }}
        />
        <button data-testid="chat-send" onClick={submit} disabled={streaming}>{t('common.ok')}</button>
      </div>
    </div>
  );
}
