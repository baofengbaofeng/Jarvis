import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

export function ChatPage() {
  const { t } = useTranslation('common');
  return (
    <div data-testid="chat-page" style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', padding: 12, borderBottom: '1px solid var(--border)' }}>
        <span>{t('app.title')}</span>
        <LanguageSwitcher />
      </header>
      <main style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        <textarea data-testid="chat-input" placeholder={t('chat.placeholder')} style={{ width: '100%', minHeight: 80 }} />
      </main>
    </div>
  );
}
