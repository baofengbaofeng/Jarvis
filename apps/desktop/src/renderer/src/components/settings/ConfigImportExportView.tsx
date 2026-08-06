import { useState } from 'react';
import { useTranslation } from 'react-i18next';

type Strategy = 'skip' | 'overwrite' | 'merge';

// C12 (M8 Task 6): config import/export UI. Export writes jarvis-config.json/yaml
// through config.export + dialog.saveText; import opens a file via dialog.openFile,
// reads it via fs.readFile, then applies it via config.import with the chosen
// skip/overwrite/merge strategy. API keys never leave main (export carries only
// apiKeyRef), so no keychain access happens here.
export function ConfigImportExportView() {
  const { t } = useTranslation('common');
  const [strategy, setStrategy] = useState<Strategy>('skip');
  const [msg, setMsg] = useState('');
  const onExport = async (format: 'json' | 'yaml') => {
    const text = (await window.jarvis.invoke('config.export', format)) as string;
    await window.jarvis.invoke('dialog.saveText', { defaultName: `jarvis-config.${format}`, content: text });
  };
  const onImport = async () => {
    const { path } = (await window.jarvis.invoke('dialog.openFile', {
      filters: [{ name: 'config', extensions: ['json', 'yaml', 'yml'] }],
    })) as { path: string };
    if (!path) return;
    const text = (await window.jarvis.invoke('config.readPickedFile', path)) as string;
    setMsg(JSON.stringify(await window.jarvis.invoke('config.import', text, strategy)));
  };
  return (
    <div data-testid="config-transfer">
      <h3>{t('configTransfer.title')}</h3>
      <div>
        <button data-testid="export-json" onClick={() => void onExport('json')}>{t('configTransfer.exportJson')}</button>
        <button data-testid="export-yaml" onClick={() => void onExport('yaml')}>{t('configTransfer.exportYaml')}</button>
      </div>
      <label>
        {t('configTransfer.strategy')}
        <select data-testid="strategy" value={strategy} onChange={e => setStrategy(e.target.value as Strategy)}>
          <option value="skip">{t('configTransfer.strategySkip')}</option>
          <option value="overwrite">{t('configTransfer.strategyOverwrite')}</option>
          <option value="merge">{t('configTransfer.strategyMerge')}</option>
        </select>
      </label>
      <div>
        <button data-testid="import" onClick={() => void onImport()}>{t('configTransfer.import')}</button>
      </div>
      {msg && <div data-testid="transfer-msg">{msg}</div>}
    </div>
  );
}
