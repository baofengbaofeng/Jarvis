import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Panel } from '@jarvis/ui';
import { FileTree } from '../components/coding/FileTree';
import { CodePreview } from '../components/coding/CodePreview';
import { SplitLayout } from '../components/coding/SplitLayout';
import { DiffPanel } from '../components/coding/DiffPanel';
import type { TreeNode } from '@jarvis/core/renderer';
import { useTaskStore } from '../stores/task-store';

interface DiffState { taskId: string; path: string; base: string; modified: string }

export function CodingPanelPage() {
  const { t } = useTranslation('common');
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [preview, setPreview] = useState<{ path: string; code: string } | null>(null);
  const [diff, setDiff] = useState<DiffState | null>(null);
  const activeTaskId = useTaskStore((s) => s.activeTaskId);
  const refresh = useCallback(async () => setTree((await window.jarvis.invoke('workspace.tree')) as TreeNode[]), []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const h = () => { void refresh(); };
    window.addEventListener('jarvis:refresh-tree', h);
    return () => window.removeEventListener('jarvis:refresh-tree', h);
  }, [refresh]);
  const open = async (path: string) => {
    const r = (await window.jarvis.invoke('workspace.read', path)) as { ok: boolean; content?: string; error?: string };
    if (r.ok && r.content != null) setPreview({ path, code: r.content });
    if (activeTaskId) {
      const d = (await window.jarvis.invoke('diff.read', { taskId: activeTaskId, path })) as { ok: boolean; base?: string; modified?: string; changed?: boolean; error?: string };
      if (d.ok && d.base != null && d.modified != null) {
        setDiff(d.changed ? { taskId: activeTaskId, path, base: d.base, modified: d.modified } : null);
      } else {
        setDiff(null);
      }
    } else {
      setDiff(null);
    }
  };
  return (
    <div data-testid="coding-panel" className="page page--wide">
      <h2 className="page__title">{t('menu.coding')}</h2>
      <SplitLayout
        left={<FileTree nodes={tree} onSelect={(p) => void open(p)} />}
        right={preview ? <CodePreview path={preview.path} code={preview.code} /> : <div className="empty-text">{t('coding.selectFile')}</div>}
      />
      {diff && (
        <Panel elevated data-testid="diff-section" className="form-stack form-stack--spaced-lg">
          <h3 className="page__title">{t('diff.title')}</h3>
          <DiffPanel key={diff.path} taskId={diff.taskId} path={diff.path} base={diff.base} modified={diff.modified} />
        </Panel>
      )}
    </div>
  );
}
