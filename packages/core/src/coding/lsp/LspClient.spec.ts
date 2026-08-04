import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import { LspClient, type LspClientDeps } from './LspClient';

interface FakeProcLike { stdout: PassThrough; stdin: { write(d: string): void; end(): void }; kill(): void }

function frame(msg: unknown): Buffer {
  const body = JSON.stringify(msg);
  return Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

function makeFakeProc(): FakeProcLike {
  const stdout = new PassThrough();
  const stdin = {
    write(d: string) {
      const body = d.slice(d.indexOf('\r\n\r\n') + 4);
      const msg = JSON.parse(body);
      if (msg.method === 'initialize') { const id = msg.id as number; stdout.write(frame({ jsonrpc: '2.0', id, result: { capabilities: {} } })); }
      if (msg.method === 'textDocument/didOpen') {
        const uri = (msg.params as { textDocument: { uri: string } }).textDocument.uri;
        setImmediate(() => stdout.write(frame({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri, diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: 'TS2322 err' }] } })));
      }
    },
    end() {}
  };
  return { stdout, stdin, kill() {} };
}

describe('LspClient', () => {
  it('initializes and collects publishDiagnostics for an opened doc', async () => {
    const proc = makeFakeProc();
    const deps: LspClientDeps = { spawnImpl: () => proc as unknown as import('node:child_process').ChildProcess };
    const lsp = new LspClient('/ws', 'tsserver', ['--stdio'], deps);
    await lsp.initialize();
    lsp.didOpen('file:///ws/a.ts', 'const x: string = 1;');
    await new Promise(r => setImmediate(r));
    const diags = lsp.pullDiagnostics('file:///ws/a.ts');
    expect(diags.length).toBe(1);
    expect(diags[0].message).toContain('TS2322');
    lsp.shutdown();
  });
});
