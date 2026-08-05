import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkflowStore } from '../../stores/workflow-store';

// F10 (M8 Task 9): lightweight DAG workflow editor — node cards + an explicit
// outgoing-edge list, NOT a react-flow drag canvas (full drag-and-drop is an
// enhancement; toWorkflow/store stay unchanged either way).
export function WorkflowEditor() {
  const { t } = useTranslation('common');
  const { nodes, edges, agents, outputs, loadAgents, addNode, removeNode, setInput, run } = useWorkflowStore();
  useEffect(() => { void loadAgents(); }, [loadAgents]);
  return (
    <div data-testid="workflow-editor">
      <h2 data-testid="workflow-title">{t('workflow.title')}</h2>
      <div className="workflow-toolbar">
        {agents.map(a => (
          <button key={a.id} data-testid={`add-${a.id}`} onClick={() => addNode(a.id)}>
            {t('workflow.add', { name: a.name })}
          </button>
        ))}
        <button data-testid="workflow-run" onClick={() => void run()}>{t('workflow.run')}</button>
      </div>
      <div className="workflow-canvas" data-testid="workflow-canvas">
        {nodes.map(n => (
          <div key={n.id} className="wf-node" data-testid={`wf-node-${n.id}`}>
            <span>{n.agentId}</span>
            <input
              data-testid={`wf-input-${n.id}`}
              value={n.input}
              onChange={e => setInput(n.id, e.target.value)}
              placeholder={t('workflow.inputPlaceholder')}
            />
            <button
              data-testid={`wf-remove-${n.id}`}
              aria-label={t('workflow.remove')}
              onClick={() => removeNode(n.id)}
            >✕</button>
            {edges.filter(e => e.from === n.id).map(e => (
              <div key={e.id} className="wf-edge" data-testid="wf-edge">{t('workflow.edge', { to: e.to })}</div>
            ))}
          </div>
        ))}
      </div>
      {outputs && <pre data-testid="wf-outputs">{JSON.stringify(outputs, null, 2)}</pre>}
    </div>
  );
}
