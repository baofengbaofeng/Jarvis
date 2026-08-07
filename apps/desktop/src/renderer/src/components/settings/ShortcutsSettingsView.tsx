import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Panel } from '@jarvis/ui';
import { DEFAULT_SHORTCUTS, normalizeCombo, type ShortcutAction, type ShortcutBindings } from '@jarvis/core/renderer';

const ACTION_LABEL_KEY: Record<ShortcutAction, string> = {
  'chat.send': 'shortcuts.action.chatSend',
  'chat.new': 'shortcuts.action.chatNew',
  'settings.open': 'shortcuts.action.settingsOpen',
  'task.cancel': 'shortcuts.action.taskCancel',
  'focus.input': 'shortcuts.action.focusInput',
};

export function ShortcutsSettingsView() {
  const { t } = useTranslation('common');
  const [bindings, setBindings] = useState<ShortcutBindings>(DEFAULT_SHORTCUTS);
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  useEffect(() => {
    void (async () => setBindings((await window.jarvis.invoke('shortcuts.get')) as ShortcutBindings))();
  }, []);
  const capture = (a: ShortcutAction) => (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setRecording(null);
    setBindings(b => ({ ...b, [a]: normalizeCombo(e.nativeEvent) }));
  };
  const save = async () => {
    await window.jarvis.invoke('shortcuts.set', bindings);
    setRecording(null);
  };
  return (
    <div data-testid="shortcuts-view" className="form-stack">
      <h3 className="page__title">{t('shortcuts.title')}</h3>
      <Panel>
        {(Object.keys(bindings) as ShortcutAction[]).map(a => (
          <div key={a} data-testid="shortcut-row" className="shortcut-row">
            <span>{t(ACTION_LABEL_KEY[a])}</span>
            <Button variant="ghost" size="sm" data-testid={`record-${a}`} onClick={() => setRecording(a)}>
              {recording === a ? t('shortcuts.press_key') : bindings[a]}
            </Button>
            {recording === a && (
              <button data-testid={`capture-${a}`} onKeyDown={capture(a)} autoFocus>
                {t('shortcuts.capture')}
              </button>
            )}
          </div>
        ))}
      </Panel>
      <Button variant="primary" data-testid="shortcuts-save" onClick={() => void save()}>
        {t('shortcuts.save')}
      </Button>
    </div>
  );
}
