import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal, ModalMessage, PageHeader, Select } from '@jarvis/ui';

type Strategy = 'skip' | 'overwrite' | 'merge';

export function ConfigImportExportView() {
  const { t } = useTranslation('common');
  const [strategy, setStrategy] = useState<Strategy>('skip');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);

  const onExport = async (format: 'json' | 'yaml') => {
    const text = (await window.jarvis.invoke('config.export', format)) as string;
    await window.jarvis.invoke('dialog.saveText', { defaultName: `jarvis-config.${format}`, content: text });
  };

  const runImport = async () => {
    setError(null);
    const caps = (await window.jarvis.invoke('dialog.pickPath', { purpose: 'config-import' })) as Array<{ token: string }>;
    const cap = caps[0];
    if (!cap) return;
    const text = (await window.jarvis.invoke('config.readPickedFile', { capability: cap.token })) as string;
    const res = (await window.jarvis.invoke('config.import', text, strategy)) as
      | { ok: true; summary?: unknown }
      | { ok: false; error: string }
      | Record<string, unknown>;
    if (res && typeof res === 'object' && 'ok' in res && res.ok === false) {
      setError(String((res as { error: string }).error));
      setMsg('');
      return;
    }
    setMsg(typeof res === 'object' ? JSON.stringify(res, null, 2) : String(res));
  };

  const onImport = () => {
    if (strategy === 'overwrite') {
      setConfirmOverwrite(true);
      return;
    }
    void runImport();
  };

  return (
    <div data-testid="config-transfer" className="page form-stack settings-page">
      <PageHeader title={t('configTransfer.title')} subtitle={t('configTransfer.subtitle')} />
      <div className="page__actions">
        <Button variant="ghost" data-testid="export-json" onClick={() => void onExport('json')}>{t('configTransfer.exportJson')}</Button>
        <Button variant="ghost" data-testid="export-yaml" onClick={() => void onExport('yaml')}>{t('configTransfer.exportYaml')}</Button>
      </div>
      <div className="form-field">
        <label htmlFor="strategy">{t('configTransfer.strategy')}</label>
        <p className="form-field__hint">{t('configTransfer.strategyHint')}</p>
        <Select id="strategy" data-testid="strategy" value={strategy} onChange={e => setStrategy(e.target.value as Strategy)}>
          <option value="skip">{t('configTransfer.strategySkip')}</option>
          <option value="overwrite">{t('configTransfer.strategyOverwrite')}</option>
          <option value="merge">{t('configTransfer.strategyMerge')}</option>
        </Select>
      </div>
      <Button variant="primary" data-testid="import" onClick={() => onImport()}>{t('configTransfer.import')}</Button>
      {error ? <p data-testid="transfer-error" role="alert" className="form-field__error">{error}</p> : null}
      {msg ? <pre data-testid="transfer-msg" className="settings-card__meta">{msg}</pre> : null}

      <Modal
        open={confirmOverwrite}
        title={t('configTransfer.overwriteTitle')}
        testId="config-overwrite-modal"
        onClose={() => setConfirmOverwrite(false)}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmOverwrite(false)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              size="sm"
              data-testid="config-overwrite-confirm"
              onClick={() => {
                setConfirmOverwrite(false);
                void runImport();
              }}
            >
              {t('configTransfer.import')}
            </Button>
          </>
        }
      >
        <ModalMessage>{t('configTransfer.overwriteConfirm')}</ModalMessage>
      </Modal>
    </div>
  );
}
