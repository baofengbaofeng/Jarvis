export type SelectionAction = 'translate' | 'explain' | 'summarize' | 'search';
export interface SelectionRequest { text: string; action: SelectionAction; targetLang?: string }

export function buildSelectionPrompt(req: SelectionRequest): string {
  switch (req.action) {
    case 'translate': return `请把下面文本翻译成${req.targetLang ?? '中文'},只输出译文:\n\n${req.text}`;
    case 'explain': return `请解释下面文本的含义、上下文与要点:\n\n${req.text}`;
    case 'summarize': return `请用 3-5 条要点总结下面文本:\n\n${req.text}`;
    case 'search': return `请基于下面文本生成 2-3 个可直接搜索的搜索词(每行一个,不要解释):\n\n${req.text}`;
  }
}
