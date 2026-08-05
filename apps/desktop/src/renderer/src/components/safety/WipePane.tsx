import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_WIPE_TABLES, confirmPhrase, type WipeScope } from '@jarvis/core/renderer';

// L20 (M8 Task 5): sensitive-data wipe UI. The scope defaults to the FULL L20
// wipe range (all DEFAULT_WIPE_TABLES + keychain). The user must type the
// confirmation phrase returned by confirmPhrase (DELETE ALL when the keychain
// box is checked, DELETE otherwise) — matching what the main-process
// WipeService validates. The result is shown as JSON for diagnostic transparency.
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
    <div data-testid="wipe-pane">
      <label>
        <input
          type="checkbox"
          data-testid="wipe-keychain"
          checked={scope.keychain}
          onChange={e => setScope({ ...scope, keychain: e.target.checked })}
        />
        {t('safety.wipe_keychain')}
      </label>
      <input
        data-testid="wipe-phrase"
        value={phrase}
        onChange={e => setPhrase(e.target.value)}
        placeholder={confirmPhrase(scope)}
      />
      <button onClick={() => void onWipe()} data-testid="wipe-run">{t('safety.wipe_now')}</button>
      {msg && (
        <div data-testid="wipe-msg">
          <span>{t('safety.wipe_msg')}:</span> {msg}
        </div>
      )}
    </div>
  );
}
