import type { ProviderType } from '@jarvis/protocol';
import type { ProviderAdapter } from '../types';
import type { SafeHttpClient } from '../../network/SafeHttpClient';
import { OpenAIAdapter } from './openai';
import { AnthropicAdapter } from './anthropic';

export interface CreateAdapterDeps {
  fetchImpl?: typeof fetch;
  http?: SafeHttpClient;
}

export function createAdapter(type: ProviderType, deps?: CreateAdapterDeps): ProviderAdapter {
  return type === 'anthropic-compatible' ? new AnthropicAdapter(deps) : new OpenAIAdapter(deps);
}
