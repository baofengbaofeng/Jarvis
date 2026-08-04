import { describe, it, expect } from 'vitest';
import { structuredChat, StructuredOutputError } from './structured';

// structuredChat always attaches response_format, so the structured path
// (response_format present, non-empty messages) yields valid JSON. A request
// with NO messages simulates a model that ignores response_format and emits
// free text — used by the invalid-JSON test below.
async function* fakeChat(req: { messages: unknown[]; model: string; provider: unknown; response_format?: unknown }): AsyncIterable<{ deltaText: string }> {
  if (req.response_format && req.messages.length > 0) yield { deltaText: '{"ok":true,"count":3}' };
  else yield { deltaText: 'not json {' };
}

describe('structuredChat', () => {
  it('collects chunks, parses JSON, validates', async () => {
    const out = await structuredChat(fakeChat, {
      messages: [{ role: 'user', content: 'x' }], model: 'm', provider: { type: 'openai', id: 'p' },
      schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }
    }, (o) => { const v = o as { ok?: boolean }; return v.ok ? null : 'missing ok'; });
    expect(out).toEqual({ ok: true, count: 3 });
  });

  it('throws StructuredOutputError on invalid JSON', async () => {
    await expect(structuredChat(fakeChat, { messages: [], model: 'm', provider: { type: 'openai', id: 'p' }, schema: {} }, () => null))
      .rejects.toThrow(StructuredOutputError);
  });
});
