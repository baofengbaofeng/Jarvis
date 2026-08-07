import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabPanel } from '@jarvis/ui';
import { BackupPane } from './BackupPane';
import { WipePane } from './WipePane';

export function DataSafetyPage() {
  const { t } = useTranslation('common');
  const [tab, setTab] = useState<'backup' | 'wipe'>('backup');
  const [localOnly, setLocalOnly] = useState(false);
  const onLocalOnly = async (checked: boolean) => {
    setLocalOnly(checked);
    await window.jarvis.settingsSet('data_policy', { local_only: checked });
  };
  return (
    <div data-testid="data-safety-page" className="form-stack">
      <Tabs
        tabs={[
          { id: 'backup', label: t('safety.tab.backup'), testId: 'safety-tab-backup' },
          { id: 'wipe', label: t('safety.tab.wipe'), testId: 'safety-tab-wipe' },
        ]}
        active={tab}
        onChange={(id) => setTab(id as 'backup' | 'wipe')}
      />
      <TabPanel active={tab === 'backup'}><BackupPane /></TabPanel>
      <TabPanel active={tab === 'wipe'}><WipePane /></TabPanel>
      <label className="checkbox-label">
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
