import i18n from 'i18next';
import { IpcEvent, type TaskStatus } from '@jarvis/protocol';
import { useChatStore } from './chat-store';
import { useTaskStore } from './task-store';
import { useApprovalStore, type ApprovalRequest } from './approval-store';
import { useSquadStore } from './squad-store';
import { pushSquadEvent } from './squad-store';
import { toast } from './toast-store';

let initialized = false;

/** Install renderer IPC event subscriptions once (called from initRendererState). */
export function initIpcSubscriptions(): void {
  if (initialized) return;
  if (typeof window === 'undefined' || !window.jarvis?.onDidReceive) return;
  initialized = true;

  window.jarvis.onDidReceive(IpcEvent.chatDelta, (payload) => {
    const { sessionId, chunk } = payload as { sessionId: string; chunk: { kind: string; delta?: string } };
    if (sessionId !== useChatStore.getState().sessionId) return;
    if (chunk.kind === 'delta') useChatStore.getState().appendDelta(chunk.delta ?? '');
  });

  window.jarvis.onDidReceive(IpcEvent.chatDone, (p) => {
    const { sessionId, error } = p as { sessionId: string; error?: string };
    if (sessionId !== useChatStore.getState().sessionId) return;
    useChatStore.getState().finishStream(undefined, error);
  });

  window.jarvis.onDidReceive(IpcEvent.taskLog, (p) => {
    const { id, line } = p as { id: string; line: string };
    if (id !== useTaskStore.getState().activeTaskId) return;
    useTaskStore.getState().appendLog(line);
    const chat = useChatStore.getState();
    if (chat.streamingTaskSessionId !== chat.sessionId) return;
    chat.appendDelta(line);
  });

  window.jarvis.onDidReceive(IpcEvent.taskComplete, (p) => {
    const { id, text } = p as { id: string; text: string };
    useTaskStore.getState().setStatus(id, 'completed');
    const chat = useChatStore.getState();
    if (id !== useTaskStore.getState().activeTaskId) return;
    if (chat.streamingTaskSessionId !== chat.sessionId) return;
    chat.finishStream(text);
  });

  window.jarvis.onDidReceive(IpcEvent.taskFailed, (p) => {
    const { id, text } = p as { id: string; text: string };
    useTaskStore.getState().setStatus(id, 'failed');
    const chat = useChatStore.getState();
    if (id !== useTaskStore.getState().activeTaskId) return;
    if (chat.streamingTaskSessionId !== chat.sessionId) return;
    chat.finishStream(undefined, text);
  });

  window.jarvis.onDidReceive(IpcEvent.taskState, (p) => {
    const { id, state } = p as { id: string; state: TaskStatus };
    useTaskStore.getState().setStatus(id, state);
    const chat = useChatStore.getState();
    if (id !== useTaskStore.getState().activeTaskId) return;
    if (chat.streamingTaskSessionId !== chat.sessionId) return;
    if (state === 'cancelled') chat.finishStream(undefined, i18n.t('chat.taskCancelled'));
  });

  window.jarvis.onDidReceive(IpcEvent.approvalRequest, (payload) => {
    const req = payload as ApprovalRequest;
    useApprovalStore.setState((s) => ({
      pending: s.pending.some((p) => p.id === req.id) ? s.pending : [...s.pending, req]
    }));
  });

  window.jarvis.onDidReceive(IpcEvent.squadEvent, (payload) => {
    pushSquadEvent(payload as Parameters<typeof pushSquadEvent>[0]);
  });

  window.jarvis.onDidReceive(IpcEvent.squadStatus, (payload) => {
    const { id, state } = payload as { id: string; state: string };
    const cur = useSquadStore.getState().review;
    if (state === 'in_review') {
      if (!cur || cur.id !== id) useSquadStore.setState({ review: { id, summary: '', members: [] } });
    } else if (cur?.id === id) {
      useSquadStore.setState({ review: null });
    }
  });

  window.jarvis.onDidReceive(IpcEvent.toastPush, (payload) => {
    const { kind, message } = payload as { kind: 'info' | 'success' | 'error'; message: string };
    toast(kind, message);
  });
}

/** Test-only reset so specs can re-install subscriptions. */
export function resetIpcSubscriptionsForTests(): void {
  initialized = false;
}
