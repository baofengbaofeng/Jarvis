import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Panel, Select } from '@jarvis/ui';

type Strategy = 'skip' | 'overwrite' | 'merge';

export function ConfigImportExportView() {
  const { t } = useTranslation('common');
  const [strategy, setStrategy] = useState<Strategy>('skip');
  const [msg, setMsg] = useState('');
  const onExport = async (format: 'json' | 'yaml') => {
    const text = (await window.jarvis.invoke('config.export', format)) as string;
    await window.jarvis.invoke('dialog.saveText', { defaultName: `jarvis-config.${format}`, content: text });
  };
  const onImport = async () => {
    const caps = (await window.jarvis.invoke('dialog.pickPath', { purpose: 'config-import' })) as Array<{ token: string }>;
    const cap = caps[0];
    if (!cap) return;
    const text = (await window.jarvis.invoke('config.readPickedFile', { capability: cap.token })) as string;
    setMsg(JSON.stringify(await window.jarvis.invoke('config.import', text, strategy)));
  };
  return (
    <div data-testid="config-transfer" className="form-stack">
      <h3 className="page__title">{t('configTransfer.title')}</h3>
      <div className="page__actions">
        <Button variant="ghost" data-testid="export-json" onClick={() => void onExport('json')}>{t('configTransfer.exportJson')}</Button>
        <Button variant="ghost" data-testid="export-yaml" onClick={() => void onExport('yaml')}>{t('configTransfer.exportYaml')}</Button>
      </div>
      <div className="form-field">
        <label htmlFor="strategy">{t('configTransfer.strategy')}</label>
        <Select id="strategy" data-testid="strategy" value={strategy} onChange={e => setStrategy(e.target.value as Strategy)}>
          <option value="skip">{t('configTransfer.strategySkip')}</option>
          <option value="overwrite">{t('configTransfer.strategyOverwrite')}</option>
          <option value="merge">{t('configTransfer.strategyMerge')}</option>
        </Select>
      </div>
      <Button variant="primary" data-testid="import" onClick={() => void onImport()}>{t('configTransfer.import')}</Button>
      {msg && <Panel data-testid="transfer-msg"><pre>{msg}</pre></Panel>}
    </div>
  );
}
