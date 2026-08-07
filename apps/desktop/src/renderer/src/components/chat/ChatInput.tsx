import { useState, type ClipboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Composer } from '@jarvis/ui';
import type { MentionCandidate } from '@jarvis/core/renderer';
import { useChatStore } from '../../stores/chat-store';
import { MentionPicker } from '../coding/MentionPicker';
import { ImageAttachment } from '../office/ImageAttachment';

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
    if (!value && pendingImages.length === 0) return;
    setText('');
    setMentionOpen(false);
    void send(value);
  };

  const onChange = (value: string) => {
    setText(value);
    setMentionOpen(TRAILING_AT.test(value));
  };

  const selectMention = (c: MentionCandidate) => {
    setText((prev) => prev.replace(TRAILING_AT, (m, q) => m.slice(0, m.length - q.length) + c.label));
    setMentionOpen(false);
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const images = [...e.clipboardData.files].filter(f => f.type.startsWith('image/'));
    if (!images.length) return;
    e.preventDefault();
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
    <Composer
      value={text}
      onChange={onChange}
      onSubmit={submit}
      placeholder={t('chat.placeholder')}
      sendLabel={t('common.ok')}
      disabled={streaming}
      inputTestId="chat-input"
      sendTestId="chat-send"
      onPaste={onPaste}
      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
      toolbar={mentionOpen ? <MentionPicker onSelect={selectMention} onClose={() => setMentionOpen(false)} /> : undefined}
      attachments={pendingImages.length > 0 ? (
        <div data-testid="pending-images">
          {pendingImages.map((src) => <ImageAttachment key={src} src={src} onRemove={removeImage} />)}
        </div>
      ) : undefined}
    />
  );
}
