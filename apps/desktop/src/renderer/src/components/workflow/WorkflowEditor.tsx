import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Panel, Select } from '@jarvis/ui';
import { useWorkflowStore } from '../../stores/workflow-store';

export function WorkflowEditor() {
  const { t } = useTranslation('common');
  const { nodes, edges, agents, outputs, loadAgents, addNode, removeNode, connect, setInput, run } = useWorkflowStore();
  useEffect(() => { void loadAgents(); }, [loadAgents]);
  return (
    <div data-testid="workflow-editor" className="page page--wide">
      <h2 data-testid="workflow-title" className="page__title">{t('workflow.title')}</h2>
      <div className="workflow-toolbar">
        {agents.map(a => (
          <Button key={a.id} variant="ghost" size="sm" data-testid={`add-${a.id}`} onClick={() => addNode(a.id)}>
            {t('workflow.add', { name: a.name })}
          </Button>
        ))}
        <Button variant="primary" data-testid="workflow-run" onClick={() => void run()}>{t('workflow.run')}</Button>
      </div>
      <div className="workflow-canvas" data-testid="workflow-canvas">
        {nodes.map(n => (
          <Panel key={n.id} className="wf-node" data-testid={`wf-node-${n.id}`}>
            <div className="settings-card__title">{n.agentId}</div>
            <Input
              data-testid={`wf-input-${n.id}`}
              value={n.input}
              onChange={e => setInput(n.id, e.target.value)}
              placeholder={t('workflow.inputPlaceholder')}
            />
            <Select
              data-testid={`wf-connect-${n.id}`}
              value=""
              onChange={e => { if (e.target.value) connect(n.id, e.target.value); }}
            >
              <option value="">{t('workflow.connectTo')}</option>
              {nodes.filter(o => o.id !== n.id).map(o => (
                <option key={o.id} value={o.id}>{o.agentId}</option>
              ))}
            </Select>
            <Button variant="ghost" size="sm" data-testid={`wf-remove-${n.id}`} aria-label={t('workflow.remove')} onClick={() => removeNode(n.id)}>✕</Button>
            {edges.filter(e => e.from === n.id).map(e => (
              <div key={e.id} className="wf-edge" data-testid="wf-edge">{t('workflow.edge', { to: e.to })}</div>
            ))}
          </Panel>
        ))}
      </div>
      {outputs && <Panel data-testid="wf-outputs"><pre>{JSON.stringify(outputs, null, 2)}</pre></Panel>}
    </div>
  );
}
