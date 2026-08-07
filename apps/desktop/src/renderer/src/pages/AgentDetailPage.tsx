import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Panel, Textarea } from '@jarvis/ui';
import { useAgentStore } from '../stores/agent-store';

export function AgentDetailPage({ agentId, onClose }: { agentId: string | null; onClose: () => void }) {
  const { t } = useTranslation('common');
  const { agents, create, update } = useAgentStore();
  const existing = agents.find(a => a.id === agentId);
  const [name, setName] = useState(existing?.name ?? '');
  const [systemPrompt, setSystemPrompt] = useState(existing?.systemPrompt ?? '');
  const [modelId, setModelId] = useState<string | null>(existing?.modelId ?? null);
  const [workspaceLabel, setWorkspaceLabel] = useState<string | null>(existing?.workspaceId ? t('agent.workspaceBound') : null);
  const [pendingBindToken, setPendingBindToken] = useState<string | null>(null);

  const pickWorkspace = async () => {
    const caps = (await window.jarvis.invoke('dialog.pickPath', { purpose: 'workspace-bind' })) as Array<{ token: string; name: string }>;
    const cap = caps[0];
    if (!cap) return;
    setWorkspaceLabel(cap.name);
    if (agentId) {
      await window.jarvis.invoke('workspace.bind', agentId, { capability: cap.token });
      setPendingBindToken(null);
    } else {
      setPendingBindToken(cap.token);
    }
  };

  const save = async () => {
    if (agentId) {
      await update(agentId, { name, systemPrompt, modelId });
    } else {
      const created = await create({ name, systemPrompt, modelId, workspaceId: null });
      if (pendingBindToken) {
        await window.jarvis.invoke('workspace.bind', created.id, { capability: pendingBindToken });
      }
    }
    onClose();
  };

  return (
    <Panel elevated data-testid="agent-detail" className="form-stack">
      <div className="form-field">
        <label htmlFor="agent-name">{t('settings.provider.name')}</label>
        <Input id="agent-name" data-testid="agent-name" value={name} onChange={e => setName(e.target.value)} />
      </div>
      <div className="form-field">
        <label htmlFor="agent-prompt">{t('agent.systemPrompt')}</label>
        <Textarea id="agent-prompt" data-testid="agent-prompt" value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} rows={6} />
      </div>
      <div className="form-field">
        <label htmlFor="agent-model">{t('agent.modelId')}</label>
        <Input id="agent-model" data-testid="agent-model" value={modelId ?? ''} onChange={e => setModelId(e.target.value || null)} />
      </div>
      <div className="page__actions">
        <Button variant="ghost" data-testid="agent-bind-workspace" onClick={() => void pickWorkspace()}>{workspaceLabel ?? t('agent.bindWorkspace')}</Button>
        <Button variant="primary" data-testid="agent-save" onClick={() => void save()}>{t('common.save')}</Button>
      </div>
    </Panel>
  );
}
