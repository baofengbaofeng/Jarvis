import { describe, it, expect } from 'vitest';
import {
  providerBaseUrlError,
  sanitizeProviderNameInput,
  isValidProviderName,
  sanitizeProviderModelIdInput,
  isValidProviderModelId,
  sanitizeProviderModelNameInput,
} from './provider-fields';

describe('providerBaseUrlError', () => {
  it('requires http:// or https:// prefix', () => {
    expect(providerBaseUrlError('ftp://x.com')).toBe('URL_PROTOCOL_REQUIRED');
    expect(providerBaseUrlError('api.openai.com')).toBe('URL_PROTOCOL_REQUIRED');
    expect(providerBaseUrlError('')).toBe('URL_PROTOCOL_REQUIRED');
  });

  it('accepts http and https URLs that match the regex', () => {
    expect(providerBaseUrlError('https://api.openai.com/v1')).toBeNull();
    expect(providerBaseUrlError('http://api.openai.com')).toBeNull();
    expect(providerBaseUrlError('https://127.0.0.1:8443/v1')).toBeNull();
    expect(providerBaseUrlError('http://localhost:3000')).toBeNull();
  });

  it('rejects malformed hosts and credentials', () => {
    expect(providerBaseUrlError('https://')).toBe('URL_INVALID');
    expect(providerBaseUrlError('https://user:pass@api.openai.com')).toBe('URL_CREDENTIALS_FORBIDDEN');
  });
});

describe('provider name charset', () => {
  it('allows Chinese, Latin letters, digits, hyphen, underscore', () => {
    expect(isValidProviderName('深度-Seek_A')).toBe(true);
    expect(isValidProviderName('GPT4')).toBe(true);
    expect(isValidProviderName('Provider-2')).toBe(true);
  });

  it('rejects empty and other special characters', () => {
    expect(isValidProviderName('')).toBe(false);
    expect(isValidProviderName('a.b')).toBe(false);
  });

  it('strips disallowed characters on input', () => {
    expect(sanitizeProviderNameInput('GPT-4 测试!')).toBe('GPT-4测试');
  });
});

describe('provider model id charset', () => {
  it('allows letters, digits, hyphen, underscore', () => {
    expect(isValidProviderModelId('gpt-4o_mini')).toBe(true);
  });

  it('rejects other characters', () => {
    expect(isValidProviderModelId('gpt.4')).toBe(false);
    expect(isValidProviderModelId('模型')).toBe(false);
    expect(isValidProviderModelId('')).toBe(false);
  });

  it('strips disallowed characters on input', () => {
    expect(sanitizeProviderModelIdInput('gpt.4 测试!')).toBe('gpt4');
  });
});

describe('provider model display name charset', () => {
  it('matches provider name rules', () => {
    expect(sanitizeProviderModelNameInput('显示 名-称_1!')).toBe('显示名-称_1');
  });
});
