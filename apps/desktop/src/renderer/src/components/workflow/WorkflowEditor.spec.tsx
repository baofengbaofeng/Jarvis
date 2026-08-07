import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { WorkflowEditor } from './WorkflowEditor';
import { useWorkflowStore } from '../../stores/workflow-store';

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
});

beforeEach(async () => {
  (window as unknown as { jarvis: unknown }).jarvis = {
    invoke: vi.fn(async (m: string) => (m === 'agent.list' ? [{ id: 'a1', name: 'Coder' }, { id: 'a2', name: 'Reviewer' }] : null)),
    onDidReceive: () => () => {},
  };
  useWorkflowStore.setState({
    nodes: [
      { id: 'n1', agentId: 'a1', input: '' },
      { id: 'n2', agentId: 'a2', input: '' },
    ],
    edges: [],
    agents: [{ id: 'a1', name: 'Coder' }, { id: 'a2', name: 'Reviewer' }],
    outputs: null,
  });
});

afterEach(() => { cleanup(); });

// M8 final review: the F10 "编辑节点/连线" acceptance needed a UI to CREATE
// edges — previously connect() was exercised only in the store spec.
describe('WorkflowEditor connect (F10)', () => {
  it('renders a per-node downstream select over the other nodes (self excluded)', () => {
    render(<WorkflowEditor />);
    const sel = screen.getByTestId('wf-connect-n1');
    expect(sel).toBeTruthy();
    // The OTHER node is a candidate; the node itself is excluded from ITS select.
    expect(within(sel).getByRole('option', { name: 'Reviewer' })).toBeTruthy();
    expect(within(sel).queryByRole('option', { name: 'Coder' })).toBeNull();
  });

  it('calls connect(n.id, target) when a downstream target is chosen', () => {
    render(<WorkflowEditor />);
    fireEvent.change(screen.getByTestId('wf-connect-n1'), { target: { value: 'n2' } });
    expect(useWorkflowStore.getState().edges).toEqual([{ id: expect.any(String), from: 'n1', to: 'n2' }]);
  });
});
