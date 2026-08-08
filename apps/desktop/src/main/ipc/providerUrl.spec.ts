import { describe, it, expect } from 'vitest';
import { assertProviderBaseUrlShape } from './providerUrl';

describe('assertProviderBaseUrlShape', () => {
  it('accepts https and http URLs without DNS', () => {
    expect(assertProviderBaseUrlShape('https://api.openai.com/v1').hostname).toBe('api.openai.com');
    expect(assertProviderBaseUrlShape('http://api.openai.com').protocol).toBe('http:');
  });

  it('rejects missing protocol and malformed URLs', () => {
    expect(() => assertProviderBaseUrlShape('not-a-url')).toThrow('URL_PROTOCOL_REQUIRED');
    expect(() => assertProviderBaseUrlShape('')).toThrow('URL_PROTOCOL_REQUIRED');
    expect(() => assertProviderBaseUrlShape('https://')).toThrow('URL_INVALID');
  });

  it('rejects embedded credentials', () => {
    expect(() => assertProviderBaseUrlShape('https://user:pass@api.openai.com')).toThrow('URL_CREDENTIALS_FORBIDDEN');
  });

  it('allows loopback http(s) on persist (DNS policy applies on request)', () => {
    expect(assertProviderBaseUrlShape('https://127.0.0.1:8443/v1').hostname).toBe('127.0.0.1');
    expect(assertProviderBaseUrlShape('http://127.0.0.1:8080').hostname).toBe('127.0.0.1');
  });
});
