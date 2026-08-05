export type WritingAction = 'polish' | 'continue' | 'summarize' | 'translate';

export function buildWritingPrompt(action: WritingAction, text: string, lang?: string): string {
  switch (action) {
    case 'polish': return `请润色下面的文字,使其更流畅专业,保留原意,只输出润色结果:\n\n${text}`;
    case 'continue': return `请接着下面的文字自然续写一段,保持风格一致:\n\n${text}`;
    case 'summarize': return `请总结下面文字的要点:\n\n${text}`;
    case 'translate': return `请将下面的文字翻译成${lang ?? '中文'}:\n\n${text}`;
  }
}

export function splitParagraphs(text: string): string[] {
  return text.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
}

export interface TranslateResult { done: string[]; pending: string }

export async function translateWhileTyping(text: string, _targetLang: string, translate: (p: string) => Promise<string>): Promise<TranslateResult> {
  const paras = splitParagraphs(text);
  if (paras.length <= 1) return { done: [], pending: text };
  const done: string[] = [];
  for (const p of paras.slice(0, -1)) done.push(await translate(p));
  return { done, pending: paras[paras.length - 1] };
}
