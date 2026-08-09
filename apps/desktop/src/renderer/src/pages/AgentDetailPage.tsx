import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, MenuSelect, Panel, Textarea } from '@jarvis/ui';
import type { SelectableModel } from '@jarvis/protocol';
import { useAgentStore } from '../stores/agent-store';

interface McpOption {
  id: string;
  name: string;
  enabled?: boolean;
}

export function AgentDetailPage({ agentId, onClose }: { agentId: string | null; onClose: () => void }) {
  const { t } = useTranslation('common');
  const { agents, create, update } = useAgentStore();
  const existing = agents.find(a => a.id === agentId);
  const [name, setName] = useState(existing?.name ?? '');
  const [systemPrompt, setSystemPrompt] = useState(existing?.systemPrompt ?? '');
  const [modelId, setModelId] = useState<string | null>(existing?.modelId ?? null);
  const [mcpServerIds, setMcpServerIds] = useState<string[]>(existing?.mcpServerIds ?? []);
  const [mcpServers, setMcpServers] = useState<McpOption[]>([]);
  const [selectable, setSelectable] = useState<SelectableModel[]>([]);
  const [workspaceLabel, setWorkspaceLabel] = useState<string | null>(existing?.workspaceId ? t('agent.workspaceBound') : null);
  const [pendingBindToken, setPendingBindToken] = useState<string | null>(null);

  useEffect(() => {
    void window.jarvis.invoke('provider.listSelectableModels').then((rows) => {
      setSelectable(rows as SelectableModel[]);
    });
    void window.jarvis.invoke('mcp.list').then((rows) => {
      setMcpServers(Array.isArray(rows) ? rows as McpOption[] : []);
    });
  }, []);

  useEffect(() => {
    if (!existing) return;
    setMcpServerIds(existing.mcpServerIds ?? []);
  }, [existing]);

  const modelOptions = useMemo(() => {
    const opts = selectable.map((m) => ({
      value: m.id,
      label: `${m.providerName} / ${m.name?.trim() || m.modelId}`,
    }));
    if (modelId && !opts.some((o) => o.value === modelId)) {
      opts.unshift({ value: modelId, label: t('agent.modelDisabledBound') });
    }
    if (opts.length === 0) {
      opts.push({ value: '', label: t('agent.modelNone') });
    }
    return opts;
  }, [modelId, selectable, t]);

  const toggleMcp = (id: string) =>
    setMcpServerIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

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
      await update(agentId, { name, systemPrompt, modelId, mcpServerIds });
    } else {
      const created = await create({ name, systemPrompt, modelId, workspaceId: null, mcpServerIds });
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
        <span className="form-field__label" id="agent-model-label">{t('agent.modelId')}</span>
        <MenuSelect
          testId="agent-model"
          aria-label={t('agent.modelId')}
          value={modelId ?? ''}
          options={modelOptions}
          onChange={(v) => setModelId(v || null)}
        />
      </div>
      <div data-testid="agent-mcp-servers" className="checkbox-group">
        <span className="form-field__label">{t('agent.mcpServers')}</span>
        <p className="form-field__hint">{t('agent.mcpServersHint')}</p>
        {mcpServers.length === 0 ? (
          <p className="form-field__hint">{t('agent.mcpServersEmpty')}</p>
        ) : (
          mcpServers.map((s) => (
            <label key={s.id} className="checkbox-label">
              <input
                type="checkbox"
                checked={mcpServerIds.includes(s.id)}
                onChange={() => toggleMcp(s.id)}
              />
              {s.name}
              {s.enabled === false ? ` (${t('agent.mcpDisabled')})` : ''}
            </label>
          ))
        )}
      </div>
      <div className="page__actions">
        <Button variant="ghost" data-testid="agent-bind-workspace" onClick={() => void pickWorkspace()}>{workspaceLabel ?? t('agent.bindWorkspace')}</Button>
        <Button variant="primary" data-testid="agent-save" onClick={() => void save()}>{t('common.save')}</Button>
      </div>
    </Panel>
  );
}
