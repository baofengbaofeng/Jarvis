// CORE-03: shared tool-argument JSON parser. Empty / whitespace-only input is
// treated as `{}` (OpenAI often streams an empty arguments string for
// zero-arg tools). Truncated or non-object JSON must NOT collapse to `{}`.

import type { ChatChunk, ToolCall } from './types';

export type ParseToolArgumentsResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string };

export function parseToolArguments(raw: string): ParseToolArgumentsResult {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: {} };
  try {
    const value: unknown = JSON.parse(trimmed);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: `tool arguments must be a JSON object, got ${JSON.stringify(value)}` };
    }
    return { ok: true, value: value as Record<string, unknown> };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export function toolCallFromArguments(id: string, name: string, rawArgs: string): ToolCall {
  const parsed = parseToolArguments(rawArgs);
  if (parsed.ok) return { id, name, arguments: parsed.value };
  return { id, name, arguments: {}, argumentsParseError: parsed.error };
}

/** Emit an error chunk (when JSON is bad) plus the tool_call for the engine. */
export function emitToolCall(onChunk: (c: ChatChunk) => void, id: string, name: string, rawArgs: string): void {
  const call = toolCallFromArguments(id, name, rawArgs);
  if (call.argumentsParseError) {
    onChunk({ kind: 'error', error: `invalid tool arguments for ${name}: ${call.argumentsParseError}` });
  }
  onChunk({ kind: 'tool_call', toolCalls: [call] });
}
