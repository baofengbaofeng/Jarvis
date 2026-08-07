import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Panel } from '@jarvis/ui';
import { DEFAULT_WIPE_TABLES, confirmPhrase, type WipeScope } from '@jarvis/core/renderer';

export function WipePane() {
  const { t } = useTranslation('common');
  const [phrase, setPhrase] = useState('');
  const [scope, setScope] = useState<WipeScope>({ tables: DEFAULT_WIPE_TABLES, keychain: true, workspace: false });
  const [msg, setMsg] = useState('');
  const onWipe = async () => {
    try {
      const r = await window.jarvis.invoke('wipe.run', scope, phrase);
      setMsg(JSON.stringify(r));
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <div data-testid="wipe-pane" className="form-stack">
      <label className="checkbox-label">
        <input
          type="checkbox"
          data-testid="wipe-keychain"
          checked={scope.keychain}
          onChange={e => setScope({ ...scope, keychain: e.target.checked })}
        />
        {t('safety.wipe_keychain')}
      </label>
      <Input
        data-testid="wipe-phrase"
        value={phrase}
        onChange={e => setPhrase(e.target.value)}
        placeholder={confirmPhrase(scope)}
      />
      <Button variant="danger" onClick={() => void onWipe()} data-testid="wipe-run">{t('safety.wipe_now')}</Button>
      {msg && (
        <Panel data-testid="wipe-msg">
          <span>{t('safety.wipe_msg')}:</span> <pre>{msg}</pre>
        </Panel>
      )}
    </div>
  );
}
