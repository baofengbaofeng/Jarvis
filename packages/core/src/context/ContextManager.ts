import type { ModelMessage } from '../model/types';
import { estimateTokens } from '../util/token';

export interface SummarizeFn { (history: Array<{ role: string; content: string }>): Promise<string> }

export function createContextManager(deps: { summarizeFn?: SummarizeFn } = {}) {
  const summarizeFn = deps.summarizeFn;
  // Standalone so destructured use of the returned object cannot break
  // maybeSummarize via a lost `this` binding.
  const buildMessages = (history: Array<{ role: string; content: string }>, systemPrompt: string): ModelMessage[] =>
    [{ role: 'system', content: systemPrompt }, ...history.map(h => ({ role: h.role as ModelMessage['role'], content: h.content }))];
  return {
    estimateTokens,
    buildMessages,
    async maybeSummarize(history: Array<{ role: string; content: string }>, budget: number, summarize: SummarizeFn = summarizeFn!): Promise<ModelMessage[]> {
      const total = history.reduce((acc, h) => acc + estimateTokens(h.content), 0);
      if (total <= budget || !summarize) return buildMessages(history, '');
      const summary = await summarize(history);
      return [{ role: 'system', content: summary }];
    }
  };
}
