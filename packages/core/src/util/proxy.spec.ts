import { describe, it, expect } from 'vitest';
import { resolveProxyConfig } from './proxy';

describe('resolveProxyConfig', () => {
  it('defaults to none', () => {
    expect(resolveProxyConfig(undefined)).toEqual({ mode: 'none' });
  });
  it('parses custom http proxy', () => {
    expect(resolveProxyConfig({ mode: 'custom', httpUrl: 'http://127.0.0.1:7890' })).toEqual({ mode: 'custom', httpUrl: 'http://127.0.0.1:7890' });
  });
});
