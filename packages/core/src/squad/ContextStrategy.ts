import { substituteTemplate } from '../office/templates';

export type ContextPassingStrategy = 'full' | 'summary' | 'conclusion' | 'custom';

export interface ContextOpts {
  template?: string;
  summarize?: (s: string) => Promise<string>;
  vars?: Record<string, string>;
}

export async function buildPassedContext(strategy: ContextPassingStrategy, result: string, opts: ContextOpts = {}): Promise<string> {
  switch (strategy) {
    case 'full':
      return result;
    case 'summary':
      if (opts.summarize) return opts.summarize(result);
      return result.length > 2000 ? result.slice(0, 2000) : result;
    case 'conclusion': {
      const lines = result.split('\n').filter(l => /^(结论|总结|结论:|总结:|\[结论\])/.test(l.trim()));
      return lines.length ? lines.join('\n') : result.slice(0, 1000);
    }
    case 'custom':
      return substituteTemplate(opts.template ?? '{{result}}', { ...opts.vars, result });
  }
}
