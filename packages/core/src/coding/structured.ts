export class StructuredOutputError extends Error {}

export interface StructuredChatRequest {
  messages: Array<{ role: string; content: string }>;
  model: string;
  provider: { type: string; id: string };
  schema: object;
}

export type ChatFn = (req: {
  messages: unknown[]; model: string; provider: unknown;
  response_format: { type: 'json_schema'; json_schema: { name: string; schema: object } };
}) => AsyncIterable<{ deltaText?: string }>;

export async function structuredChat(
  chatFn: ChatFn,
  req: StructuredChatRequest,
  validate: (obj: unknown) => string | null = () => null,
): Promise<unknown> {
  const chunks: string[] = [];
  for await (const c of chatFn({
    messages: req.messages, model: req.model, provider: req.provider,
    response_format: { type: 'json_schema', json_schema: { name: 'result', schema: req.schema } }
  })) {
    chunks.push(c.deltaText ?? '');
  }
  const text = chunks.join('').trim();
  let obj: unknown;
  try { obj = JSON.parse(text); } catch { throw new StructuredOutputError(`invalid JSON output: ${text}`); }
  const err = validate(obj);
  if (err) throw new StructuredOutputError(err);
  return obj;
}
