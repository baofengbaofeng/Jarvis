import i18n from 'i18next';
import { IpcEvent, type TaskStatus } from '@jarvis/protocol';
import { useChatStore } from './chat-store';
import { useTaskStore } from './task-store';
import { useApprovalStore, type ApprovalRequest } from './approval-store';
import { useSquadStore } from './squad-store';
import { pushSquadEvent } from './squad-store';
import { toast } from './toast-store';

let initialized = false;

type StreamChunk = {
  kind: string;
  delta?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  name?: string;
  ok?: boolean;
  output?: string;
  arguments?: Record<string, unknown>;
};

function handleStreamChunk(chunk: StreamChunk) {
  const store = useChatStore.getState();
  if (chunk.kind === 'delta') {
    store.appendDelta(chunk.delta ?? '');
    return;
  }
  if (chunk.kind === 'tool_call' && chunk.toolCalls) {
    for (const tc of chunk.toolCalls) {
      store.upsertStep({
        id: tc.id,
        title: tc.name,
        status: 'running',
        detail: JSON.stringify(tc.arguments, null, 2),
      });
    }
    return;
  }
  if (chunk.kind === 'tool_done' && chunk.name) {
    const existing = store.steps.find((s) => s.title === chunk.name && s.status === 'running');
    store.upsertStep({
      id: existing?.id ?? `tool-${chunk.name}-${Date.now()}`,
      title: chunk.name,
      status: chunk.ok ? 'success' : 'error',
      detail: chunk.output ?? JSON.stringify(chunk.arguments ?? {}, null, 2),
    });
  }
}

/** Install renderer IPC event subscriptions once (called from initRendererState). */
export function initIpcSubscriptions(): void {
  if (initialized) return;
  if (typeof window === 'undefined' || !window.jarvis?.onDidReceive) return;
  initialized = true;

  window.jarvis.onDidReceive(IpcEvent.chatDelta, (payload) => {
    const { sessionId, chunk } = payload as { sessionId: string; chunk: StreamChunk };
    if (sessionId !== useChatStore.getState().sessionId) return;
    handleStreamChunk(chunk);
  });

  window.jarvis.onDidReceive(IpcEvent.chatDone, (p) => {
    const { sessionId, error } = p as { sessionId: string; error?: string };
    if (sessionId !== useChatStore.getState().sessionId) return;
    const localized =
      error === 'MODEL_IMAGES_UNSUPPORTED'
        ? i18n.t('settings.provider.errors.modelImagesUnsupported')
        : error;
    useChatStore.getState().finishStream(undefined, localized);
  });

  window.jarvis.onDidReceive(IpcEvent.taskLog, (p) => {
    const { id, line } = p as { id: string; line: string };
    if (id !== useTaskStore.getState().activeTaskId) return;
    const localized =
      line === 'MODEL_TOOLS_UNSUPPORTED'
        ? i18n.t('settings.provider.notices.toolsUnsupported')
        : line;
    useTaskStore.getState().appendLog(localized);
    const chat = useChatStore.getState();
    if (chat.streamingTaskSessionId !== chat.sessionId) return;
    chat.appendDelta(localized);
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
