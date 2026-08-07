import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, DataTable, EmptyState, PageHeader } from '@jarvis/ui';

interface LogFileEntry {
  name: string;
  sizeBytes: number;
  updatedAt: string;
}

interface LogLine {
  line: number;
  text: string;
}

export function LogPanelPage() {
  const { t } = useTranslation('common');
  const [files, setFiles] = useState<LogFileEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadFiles = async () => {
    const list = (await window.jarvis.invoke('logs.list')) as LogFileEntry[];
    setFiles(Array.isArray(list) ? list : []);
    if (!selected && list[0]) setSelected(list[0].name);
  };

  const loadContent = async (name: string) => {
    const res = (await window.jarvis.invoke('logs.read', { name, tail: 500 })) as { ok: boolean; lines?: LogLine[]; error?: string };
    if (!res.ok) {
      setError(res.error ?? t('settings.logs.error'));
      setLines([]);
      return;
    }
    setError(null);
    setLines(res.lines ?? []);
  };

  useEffect(() => { void loadFiles(); }, []);
  useEffect(() => { if (selected) void loadContent(selected); }, [selected]);

  return (
    <div data-testid="log-panel" className="page settings-page">
      <PageHeader
        title={t('settings.logs.title')}
        subtitle={t('settings.logs.subtitle')}
        actions={<Button variant="ghost" size="sm" onClick={() => void loadFiles()}>{t('settings.logs.refresh')}</Button>}
      />
      {files.length === 0 ? (
        <EmptyState title={t('settings.logs.empty')} description={t('settings.logs.emptyHint')} />
      ) : (
        <div className="log-panel">
          <aside className="log-panel__files">
            {files.map(f => (
              <button
                key={f.name}
                type="button"
                className={`log-panel__file${selected === f.name ? ' log-panel__file--active' : ''}`}
                onClick={() => setSelected(f.name)}
              >
                <span>{f.name}</span>
                <span className="log-panel__meta">{Math.round(f.sizeBytes / 1024)} KB</span>
              </button>
            ))}
          </aside>
          <section className="log-panel__content">
            {error != null && <div className="error-text">{error}</div>}
            <DataTable
              columns={[
                { key: 'line', header: '#', className: 'log-panel__line' },
                { key: 'text', header: t('settings.logs.message'), render: row => <code>{row.text}</code> },
              ]}
              rows={lines}
              rowKey={row => String(row.line)}
              empty={<EmptyState title={t('settings.logs.noLines')} />}
            />
          </section>
        </div>
      )}
    </div>
  );
}
