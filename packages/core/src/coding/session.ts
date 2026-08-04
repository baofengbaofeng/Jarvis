export interface SessionMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface SessionStoreAdapter {
  getMessages(taskId: string): Promise<SessionMessage[]>;
  getSummary(taskId: string): Promise<string | null>;
  saveSummary(taskId: string, text: string): Promise<void>;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2);
}

export async function resumeSession(
  adapter: SessionStoreAdapter,
  taskId: string,
  budgetTokens: number,
  summarize: (msgs: SessionMessage[]) => Promise<string>,
): Promise<SessionMessage[]> {
  const msgs = await adapter.getMessages(taskId);
  const cached = await adapter.getSummary(taskId);
  let total = cached ? estimateTokens(cached) + 64 : 0;
  const tail: SessionMessage[] = [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const t = estimateTokens(msgs[i].content);
    if (total + t > budgetTokens) break;
    total += t;
    tail.unshift(msgs[i]);
  }
  if (cached) {
    tail.unshift({ role: 'system', content: `[续接上一任务摘要]\n${cached}` });
    return tail;
  }
  if (msgs.length > tail.length) {
    const dropped = msgs.slice(0, msgs.length - tail.length);
    const s = await summarize(dropped);
    await adapter.saveSummary(taskId, s);
    tail.unshift({ role: 'system', content: `[上一任务摘要]\n${s}` });
  }
  return tail;
}
