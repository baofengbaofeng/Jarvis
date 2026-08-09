import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader, Tabs, TabPanel } from '@jarvis/ui';
import { BackupPane } from './BackupPane';
import { WipePane } from './WipePane';

export function DataSafetyPage() {
  const { t } = useTranslation('common');
  const [tab, setTab] = useState<'backup' | 'wipe'>('backup');
  const [localOnly, setLocalOnly] = useState(false);
  const [allowFakeIp, setAllowFakeIp] = useState(false);

  useEffect(() => {
    void (async () => {
      const fake = await window.jarvis.settingsGet('network.allow_fake_ip');
      if (typeof fake === 'boolean') setAllowFakeIp(fake);
    })();
  }, []);

  const onLocalOnly = async (checked: boolean) => {
    setLocalOnly(checked);
    await window.jarvis.settingsSet('data_policy', { local_only: checked });
  };

  const onAllowFakeIp = async (checked: boolean) => {
    const prev = allowFakeIp;
    setAllowFakeIp(checked);
    const res = await window.jarvis.settingsSet('network.allow_fake_ip', checked) as { ok?: boolean } | undefined;
    if (res && res.ok === false) setAllowFakeIp(prev);
  };

  return (
    <div data-testid="data-safety-page" className="page form-stack settings-page">
      <PageHeader title={t('safety.title')} subtitle={t('safety.subtitle')} />
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
      <label className="checkbox-label">
        <input
          type="checkbox"
          data-testid="allow-fake-ip"
          checked={allowFakeIp}
          onChange={e => void onAllowFakeIp(e.target.checked)}
        />
        {t('safety.allow_fake_ip')}
      </label>
      <p className="form-hint">{t('safety.allow_fake_ip_hint')}</p>
    </div>
  );
}
