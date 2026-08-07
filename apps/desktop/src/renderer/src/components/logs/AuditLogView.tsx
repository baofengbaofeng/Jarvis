import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, DataTable, PageHeader, Select } from '@jarvis/ui';
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
    <div data-testid="audit-log" className="page audit-log">
      <PageHeader
        title={t('audit.title')}
        actions={(
          <>
            <Select data-testid="audit-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">{t('audit.filter.all')}</option>
              <option value="tool_call">{t('audit.filter.tool_call')}</option>
              <option value="approval">{t('audit.filter.approval')}</option>
            </Select>
            <Button variant="ghost" size="sm" onClick={() => void onExport('csv')}>{t('audit.export')} CSV</Button>
          </>
        )}
      />
      <DataTable
        columns={[
          { key: 'ts', header: t('audit.col.ts'), render: (e) => <span data-testid="audit-row">{e.ts}</span> },
          { key: 'kind', header: t('audit.col.kind') },
          { key: 'action', header: t('audit.col.action') },
          { key: 'result', header: t('audit.col.result') },
        ]}
        rows={entries}
        rowKey={(e) => `${e.ts}-${e.action}-${e.result}`}
      />
    </div>
  );
}
