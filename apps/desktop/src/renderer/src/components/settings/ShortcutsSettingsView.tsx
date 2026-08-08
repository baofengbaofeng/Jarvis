import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, DataTable, PageHeader } from '@jarvis/ui';
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
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    void (async () => setBindings((await window.jarvis.invoke('shortcuts.get')) as ShortcutBindings))();
  }, []);

  const conflict = useMemo(() => {
    const seen = new Map<string, ShortcutAction>();
    for (const action of Object.keys(bindings) as ShortcutAction[]) {
      const combo = bindings[action]?.trim();
      if (!combo) continue;
      const other = seen.get(combo);
      if (other) return { combo, a: other, b: action };
      seen.set(combo, action);
    }
    return null;
  }, [bindings]);

  const capture = (a: ShortcutAction) => (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const combo = normalizeCombo(e.nativeEvent);
    if (!combo.trim()) {
      setError(t('shortcuts.errors.empty'));
      return;
    }
    setError(null);
    setRecording(null);
    setBindings((b) => ({ ...b, [a]: combo }));
  };

  const save = async () => {
    setStatus(null);
    if (conflict) {
      setError(t('shortcuts.errors.conflict', { combo: conflict.combo }));
      return;
    }
    for (const action of Object.keys(bindings) as ShortcutAction[]) {
      if (!bindings[action]?.trim()) {
        setError(t('shortcuts.errors.empty'));
        return;
      }
    }
    setError(null);
    await window.jarvis.invoke('shortcuts.set', bindings);
    setRecording(null);
    setStatus(t('shortcuts.saved'));
  };

  const rows = (Object.keys(bindings) as ShortcutAction[]).map((action) => ({ action }));

  return (
    <div data-testid="shortcuts-view" className="page form-stack settings-page">
      <PageHeader title={t('shortcuts.title')} subtitle={t('shortcuts.subtitle')} />
      <DataTable
        columns={[
          {
            key: 'action',
            header: t('shortcuts.colAction'),
            render: (row: { action: ShortcutAction }) => t(ACTION_LABEL_KEY[row.action]),
          },
          {
            key: 'combo',
            header: t('shortcuts.colCombo'),
            render: (row: { action: ShortcutAction }) => (
              <div className="shortcut-row" data-testid="shortcut-row">
                <Button variant="ghost" size="sm" data-testid={`record-${row.action}`} onClick={() => setRecording(row.action)}>
                  {recording === row.action ? t('shortcuts.press_key') : bindings[row.action]}
                </Button>
                {recording === row.action ? (
                  <button type="button" data-testid={`capture-${row.action}`} onKeyDown={capture(row.action)} autoFocus>
                    {t('shortcuts.capture')}
                  </button>
                ) : null}
              </div>
            ),
          },
        ]}
        rows={rows}
        rowKey={(row) => row.action}
      />
      {error ? <p data-testid="shortcuts-error" role="alert" className="form-field__error">{error}</p> : null}
      {status ? <p data-testid="shortcuts-status" className="form-field__hint">{status}</p> : null}
      <Button variant="primary" data-testid="shortcuts-save" onClick={() => void save()}>
        {t('shortcuts.save')}
      </Button>
    </div>
  );
}
