import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import type { ApprovalRequest } from '../../stores/approval-store';
import { IpcEvent } from '@jarvis/protocol';

// J2 (M3 final review): the approval modal must render a pending
// `approval:request` and route Approve/Deny back through
// window.jarvis.invoke('approval.resolve', id, ok). The store subscribes at
// module load, so the store+component are imported dynamically AFTER the
// window.jarvis bridge is installed (mirroring the chat-store guard).
let emitApproval: ((payload: unknown) => void) | undefined;
const handlers = new Map<string, (payload: unknown) => void>();
const invoke = vi.fn(async () => ({ ok: true }));
let useApprovalStore: { getState(): { pending: ApprovalRequest[]; resolve(id: string, ok: boolean): Promise<void> }; setState(p: Partial<{ pending: ApprovalRequest[] }>): void };
let ApprovalModal: () => React.JSX.Element | null;

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
  (window as unknown as { jarvis: unknown }).jarvis = {
    invoke,
    onDidReceive: (channel: string, cb: (payload: unknown) => void) => {
      handlers.set(channel, cb);
      if (channel === IpcEvent.approvalRequest) emitApproval = cb;
      return () => handlers.delete(channel);
    }
  };
  const subs = await import('../../stores/ipc-subscriptions');
  subs.initIpcSubscriptions();
  const store = await import('../../stores/approval-store');
  const modal = await import('./ApprovalModal');
  useApprovalStore = store.useApprovalStore;
  ApprovalModal = modal.ApprovalModal;
});

afterEach(() => {
  cleanup();
  invoke.mockClear();
  useApprovalStore.setState({ pending: [] });
});

describe('ApprovalModal', () => {
  it('full flow: approval:request → modal renders → Approve → approval.resolve(id, true)', async () => {
    emitApproval?.({ id: 'p1', toolName: 'run_shell', args: { command: 'sudo rm -rf /' }, prompt: 'run run_shell' });
    render(<ApprovalModal />);
    expect(screen.getByTestId('approval-modal')).toBeTruthy();
    expect(screen.getByTestId('approval-tool').textContent).toContain('run_shell');
    expect(screen.getByTestId('approval-args').textContent).toContain('sudo rm -rf /');
    fireEvent.click(screen.getByTestId('approval-approve'));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('approval.resolve', 'p1', true));
    expect(useApprovalStore.getState().pending).toHaveLength(0);
  });

  it('Deny resolves with false', async () => {
    useApprovalStore.setState({
      pending: [{ id: 'p2', toolName: 'git_commit', args: { message: 'x' }, prompt: 'run git_commit' }]
    });
    render(<ApprovalModal />);
    fireEvent.click(screen.getByTestId('approval-deny'));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('approval.resolve', 'p2', false));
  });

  it('renders nothing when there are no pending approvals', () => {
    render(<ApprovalModal />);
    expect(screen.queryByTestId('approval-modal')).toBeNull();
  });
});
