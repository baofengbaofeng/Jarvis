import type { ProviderType } from '@jarvis/protocol';
import type { ProviderAdapter } from '../types';
import { OpenAIAdapter } from './openai';
import { AnthropicAdapter } from './anthropic';

export function createAdapter(type: ProviderType, deps?: { fetchImpl?: typeof fetch }): ProviderAdapter {
  return type === 'anthropic-compatible' ? new AnthropicAdapter(deps) : new OpenAIAdapter(deps);
}
