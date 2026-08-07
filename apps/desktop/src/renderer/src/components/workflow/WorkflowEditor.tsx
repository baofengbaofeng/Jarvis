import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactFlow, { Background, Controls, type Edge, type Connection, addEdge, useEdgesState, useNodesState } from 'reactflow';
import 'reactflow/dist/style.css';
import { Button, EmptyState, Input, PageHeader, Panel, Select } from '@jarvis/ui';
import { useWorkflowStore } from '../../stores/workflow-store';

function WorkflowNodeCard({ id, agentId, input, agents, peers, onInput, onRemove, onConnect }: {
  id: string;
  agentId: string;
  input: string;
  agents: Array<{ id: string; name: string }>;
  peers: Array<{ id: string; agentId: string }>;
  onInput: (value: string) => void;
  onRemove: () => void;
  onConnect: (to: string) => void;
}) {
  const { t } = useTranslation('common');
  const agent = agents.find(a => a.id === agentId);
  return (
    <Panel className="wf-node" data-testid={`wf-node-${id}`}>
      <div className="settings-card__title">{agent?.name ?? agentId}</div>
      <Input data-testid={`wf-input-${id}`} value={input} onChange={e => onInput(e.target.value)} placeholder={t('workflow.inputPlaceholder')} />
      <Select data-testid={`wf-connect-${id}`} value="" onChange={e => { if (e.target.value) onConnect(e.target.value); }}>
        <option value="">{t('workflow.connectTo')}</option>
        {peers.filter(o => o.id !== id).map(o => (
          <option key={o.id} value={o.id}>{agents.find(a => a.id === o.agentId)?.name ?? o.agentId}</option>
        ))}
      </Select>
      <Button variant="ghost" size="sm" data-testid={`wf-remove-${id}`} onClick={onRemove}>{t('workflow.remove')}</Button>
    </Panel>
  );
}

export function WorkflowEditor() {
  const { t } = useTranslation('common');
  const { nodes, edges, agents, outputs, loadAgents, addNode, removeNode, connect, setInput, run } = useWorkflowStore();
  const [view, setView] = useState<'list' | 'graph'>('list');
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState<{ label: string }>([]);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => { void loadAgents(); }, [loadAgents]);

  useEffect(() => {
    setFlowNodes(nodes.map((n, i) => ({
      id: n.id,
      position: { x: 40 + (i % 3) * 220, y: 40 + Math.floor(i / 3) * 140 },
      data: { label: agents.find(a => a.id === n.agentId)?.name ?? n.agentId },
      type: 'default',
    })));
    setFlowEdges(edges.map(e => ({ id: e.id, source: e.from, target: e.to, animated: true })));
  }, [nodes, edges, agents, setFlowNodes, setFlowEdges]);

  const onConnectFlow = (connection: Connection) => {
    if (connection.source && connection.target) connect(connection.source, connection.target);
    setFlowEdges(eds => addEdge({ ...connection, animated: true }, eds));
  };

  const graph = useMemo(() => (
    <div className="workflow-graph" data-testid="workflow-graph">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnectFlow}
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  ), [flowNodes, flowEdges, onNodesChange, onEdgesChange, onConnectFlow]);

  return (
    <div data-testid="workflow-editor" className="page page--wide workflow-page">
      <PageHeader
        title={t('workflow.title')}
        subtitle={t('workflow.subtitle')}
        actions={(
          <>
            <Button variant={view === 'list' ? 'primary' : 'ghost'} size="sm" onClick={() => setView('list')}>{t('workflow.viewList')}</Button>
            <Button variant={view === 'graph' ? 'primary' : 'ghost'} size="sm" onClick={() => setView('graph')}>{t('workflow.viewGraph')}</Button>
            <Button variant="primary" data-testid="workflow-run" onClick={() => void run()}>{t('workflow.run')}</Button>
          </>
        )}
      />
      <div className="workflow-toolbar">
        {agents.map(a => (
          <Button key={a.id} variant="ghost" size="sm" data-testid={`add-${a.id}`} onClick={() => addNode(a.id)}>
            {t('workflow.add', { name: a.name })}
          </Button>
        ))}
      </div>
      {nodes.length === 0 ? (
        <EmptyState title={t('workflow.empty')} description={t('workflow.emptyHint')} />
      ) : view === 'graph' ? graph : (
        <div className="workflow-canvas" data-testid="workflow-canvas">
          {nodes.map(n => (
            <WorkflowNodeCard
              key={n.id}
              id={n.id}
              agentId={n.agentId}
              input={n.input}
              agents={agents}
              peers={nodes}
              onInput={value => setInput(n.id, value)}
              onRemove={() => removeNode(n.id)}
              onConnect={to => connect(n.id, to)}
            />
          ))}
        </div>
      )}
      {outputs && <Panel data-testid="wf-outputs"><pre>{JSON.stringify(outputs, null, 2)}</pre></Panel>}
    </div>
  );
}
