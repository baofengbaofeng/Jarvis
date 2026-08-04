import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileTree } from '../components/coding/FileTree';
import { CodePreview } from '../components/coding/CodePreview';
import { SplitLayout } from '../components/coding/SplitLayout';
import type { TreeNode } from '@jarvis/core';

export function CodingPanelPage() {
  const { t } = useTranslation('common');
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [preview, setPreview] = useState<{ path: string; code: string } | null>(null);
  const refresh = async () => setTree((await window.jarvis.invoke('workspace.tree')) as TreeNode[]);
  useEffect(() => { void refresh(); }, []);
  const open = async (path: string) => {
    const r = (await window.jarvis.invoke('workspace.read', path)) as { ok: boolean; content?: string; error?: string };
    if (r.ok && r.content != null) setPreview({ path, code: r.content });
  };
  return (
    <div data-testid="coding-panel">
      <h2>{t('menu.coding')}</h2>
      <SplitLayout
        left={<FileTree nodes={tree} onSelect={(p) => void open(p)} />}
        right={preview ? <CodePreview path={preview.path} code={preview.code} /> : <div>{t('coding.selectFile')}</div>}
      />
    </div>
  );
}
