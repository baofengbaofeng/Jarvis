import { describe, it, expect } from 'vitest';
import {
  assertStaticPluginCode,
  describePlugin,
  validatePluginManifest,
  encodeRpcFrame,
  decodeRpcFrame,
  MAX_RPC_FRAME_BYTES,
} from './protocol';

describe('plugin protocol', () => {
  it('accepts a contained single-file entry and stable hash', () => {
    const d = describePlugin('/plugins/p1', {
      readText: p => p.endsWith('plugin.json')
        ? '{"schemaVersion":1,"id":"p1","name":"P1","entry":"index.js","permissions":[]}'
        : 'registerTool({name:"hello",description:"",parameters:{}}, async()=>({ok:true,output:"hi"}));',
      realpath: p => p,
    });
    expect(d.entryPath).toBe('/plugins/p1/index.js');
    expect(d.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each(['../escape.js', '/tmp/x.js'])('rejects entry %s', entry => {
    expect(() => validatePluginManifest({ schemaVersion: 1, id: 'p', name: 'P', entry, permissions: [] }))
      .toThrow('PLUGIN_ENTRY_INVALID');
  });

  it.each(['import fs from "node:fs"', 'await import("node:fs")', 'require("fs")'])(
    'rejects imports: %s', code => expect(() => assertStaticPluginCode(code)).toThrow('PLUGIN_IMPORT_FORBIDDEN'));

  it('rejects RPC frames over 256 KiB before parse', () => {
    const huge = 'x'.repeat(MAX_RPC_FRAME_BYTES + 1);
    expect(() => decodeRpcFrame(huge)).toThrow('PLUGIN_FRAME_TOO_LARGE');
    expect(() => encodeRpcFrame({ type: 'error', code: 'x', message: huge })).toThrow('PLUGIN_FRAME_TOO_LARGE');
  });
});
