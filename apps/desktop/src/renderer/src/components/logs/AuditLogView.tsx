import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuditEntry } from '@jarvis/core/renderer';

// M8 Task 3 (J5): execution-audit view. Reads the audit_logs table through the
// main-side audit.list / audit.export channels and saves exports via the
// dialog.saveText IPC (added alongside dialog.openFile in IpcRouter).
export function AuditLogView() {
  const { t } = useTranslation('common');
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [kind, setKind] = useState('');
  useEffect(() => { void load(); }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const load = async () => setEntries((await window.jarvis.invoke('audit.list', { kind: kind || undefined })) as AuditEntry[]);
  const onExport = async (format: 'csv' | 'jsonl') => {
    const content = (await window.jarvis.invoke('audit.export', { format })) as string;
    await window.jarvis.invoke('dialog.saveText', { defaultName: `audit.${format}`, content });
  };
  return (
    <div data-testid="audit-log" className="audit-log">
      <h2 className="audit-log__title">{t('audit.title')}</h2>
      <div className="audit-log__toolbar">
        <select data-testid="audit-kind" value={kind} onChange={e => setKind(e.target.value)}>
          <option value="">{t('audit.filter.all')}</option><option value="tool_call">{t('audit.filter.tool_call')}</option><option value="approval">{t('audit.filter.approval')}</option>
        </select>
        <button onClick={() => void onExport('csv')}>{t('audit.export')} CSV</button>
      </div>
      <table className="audit-log__table">
        <thead><tr><th>{t('audit.col.ts')}</th><th>{t('audit.col.kind')}</th><th>{t('audit.col.action')}</th><th>{t('audit.col.result')}</th></tr></thead>
        <tbody>{entries.map((e, i) => (
          <tr key={i} data-testid="audit-row"><td>{e.ts}</td><td>{e.kind}</td><td>{e.action}</td><td>{e.result}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}
