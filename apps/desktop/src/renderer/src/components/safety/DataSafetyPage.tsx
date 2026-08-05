import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BackupPane } from './BackupPane';
import { WipePane } from './WipePane';

// L18 (M8 Task 4) + L20/J4 (M8 Task 5): data safety page. Two tabs — Backup
// (Task 4) and Wipe (L20). At the bottom, the J4 local-only toggle persists
// `settings.data_policy.local_only` through the existing settings.set channel.
export function DataSafetyPage() {
  const { t } = useTranslation('common');
  const [tab, setTab] = useState<'backup' | 'wipe'>('backup');
  const [localOnly, setLocalOnly] = useState(false);
  const onLocalOnly = async (checked: boolean) => {
    setLocalOnly(checked);
    await window.jarvis.settingsSet('data_policy', { local_only: checked });
  };
  return (
    <div data-testid="data-safety-page">
      <div>
        <button data-testid="safety-tab-backup" onClick={() => setTab('backup')}>{t('safety.tab.backup')}</button>
        <button data-testid="safety-tab-wipe" onClick={() => setTab('wipe')}>{t('safety.tab.wipe')}</button>
      </div>
      {tab === 'backup' ? <BackupPane /> : <WipePane />}
      <label>
        <input
          type="checkbox"
          data-testid="local-only"
          checked={localOnly}
          onChange={e => void onLocalOnly(e.target.checked)}
        />
        {t('safety.local_only')}
      </label>
    </div>
  );
}
