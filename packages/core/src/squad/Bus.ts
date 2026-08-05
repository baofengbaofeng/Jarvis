export type AgentMessageKind = 'request' | 'response' | 'delegate' | 'complete' | 'log';
export interface AgentMessage {
  id: string; kind: AgentMessageKind; from: string; to: string;
  taskId?: string; payload: unknown; ts: number;
}
export class BusError extends Error {}

export function waiterKey(to: string, taskId?: string): string { return `${to}|${taskId ?? ''}`; }

export interface BusDeps { now?: () => number; id?: () => string }

export class MessageBus {
  private subs = new Set<(m: AgentMessage) => void>();
  private waiters = new Map<string, { resolve: (m: AgentMessage) => void; timer: ReturnType<typeof setTimeout> }>();
  constructor(private deps: BusDeps = {}) {}

  post(msg: Omit<AgentMessage, 'id' | 'ts'>): AgentMessage {
    const full: AgentMessage = {
      ...msg,
      id: this.deps.id?.() ?? Math.random().toString(36).slice(2),
      ts: this.deps.now?.() ?? Date.now()
    };
    for (const s of [...this.subs]) s(full);
    if (msg.kind === 'response') {
      const key = waiterKey(msg.to, msg.taskId);
      const w = this.waiters.get(key);
      if (w) { clearTimeout(w.timer); this.waiters.delete(key); w.resolve(full); }
    }
    return full;
  }

  subscribe(fn: (m: AgentMessage) => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  request(req: { kind: 'request' | 'delegate'; from: string; to: string; taskId?: string; payload: unknown }, timeoutMs = 60_000): Promise<AgentMessage> {
    return new Promise((resolve, reject) => {
      // The waiter is keyed by the REQUESTER (req.from) + taskId so that a
      // response addressed TO that requester matches by (to, taskId) — the L12
      // spec: "response 按 (to, taskId) 匹配 pending waiter". Keying by req.to
      // (the brief's original) would never match: the response's `to` is the
      // requester, not the destination the request was sent to.
      const key = waiterKey(req.from, req.taskId);
      const timer = setTimeout(() => {
        this.waiters.delete(key);
        reject(new BusError(`timeout: no response from ${req.to} within ${timeoutMs}ms`));
      }, timeoutMs);
      this.waiters.set(key, { resolve, timer });
      this.post({ ...req, kind: req.kind });
    });
  }
}
