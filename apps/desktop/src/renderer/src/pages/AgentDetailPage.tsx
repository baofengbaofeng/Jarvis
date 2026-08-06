import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../stores/agent-store';

export function AgentDetailPage({ agentId, onClose }: { agentId: string | null; onClose: () => void }) {
  const { t } = useTranslation('common');
  const { agents, create, update } = useAgentStore();
  const existing = agents.find(a => a.id === agentId);
  const [name, setName] = useState(existing?.name ?? '');
  const [systemPrompt, setSystemPrompt] = useState(existing?.systemPrompt ?? '');
  const [modelId, setModelId] = useState<string | null>(existing?.modelId ?? null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(existing?.workspaceId ?? null);

  const pickWorkspace = async () => {
    const path = (await window.jarvis.invoke('dialog.openFile')) as string | null;
    if (path) { setWorkspaceId(path); if (agentId) await window.jarvis.invoke('workspace.bind', agentId, path); }
  };

  const save = async () => {
    if (agentId) await update(agentId, { name, systemPrompt, modelId, workspaceId });
    else await create({ name, systemPrompt, modelId, workspaceId });
    onClose();
  };

  return (
    <div data-testid="agent-detail">
      <input data-testid="agent-name" value={name} onChange={e => setName(e.target.value)} placeholder={t('settings.provider.name')} />
      <textarea data-testid="agent-prompt" value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} placeholder={t('agent.systemPrompt')} />
      <input data-testid="agent-model" value={modelId ?? ''} onChange={e => setModelId(e.target.value || null)} placeholder={t('agent.modelId')} />
      <button data-testid="agent-bind-workspace" onClick={() => void pickWorkspace()}>{workspaceId ?? t('agent.bindWorkspace')}</button>
      <button data-testid="agent-save" onClick={() => void save()}>{t('common.save')}</button>
    </div>
  );
}
