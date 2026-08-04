import { spawn, type ChildProcess } from 'node:child_process';

export interface LspDiagnostic { line: number; character: number; endLine: number; endCharacter: number; severity: number; message: string }
export interface SpawnFn { (cmd: string, args: string[], opts: unknown): ChildProcess }
export interface LspClientDeps { spawnImpl?: SpawnFn }

export class LspClient {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private diagnostics = new Map<string, LspDiagnostic[]>();
  private child: ChildProcess;
  private buf = '';

  // command/args/deps are only consumed in the constructor (spawn impl), so they
  // are plain params — making them parameter-properties would trip the repo's
  // noUnusedLocals (TS6138) since the fields are never read after construction.
  constructor(private rootDir: string, command: string, args: string[], deps: LspClientDeps = {}) {
    this.child = (deps.spawnImpl ?? spawn)(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    (this.child.stdout as NodeJS.ReadableStream).on('data', (d: Buffer) => { this.buf += d.toString('utf8'); this.drain(); });
  }

  private drain(): void {
    for (;;) {
      const m = /^Content-Length: (\d+)\r?\n\r?\n/.exec(this.buf);
      if (!m) { this.buf = this.buf.slice(-1000); return; }
      const len = Number(m[1]);
      if (this.buf.length < m[0].length + len) return;
      const raw = this.buf.slice(m[0].length, m[0].length + len);
      this.buf = this.buf.slice(m[0].length + len);
      try { this.handle(JSON.parse(raw)); } catch { /* skip malformed frame */ }
    }
  }

  private handle(msg: Record<string, unknown>): void {
    if (msg.method === 'textDocument/publishDiagnostics') {
      const p = msg.params as { uri: string; diagnostics: Array<{ range: { start: { line: number; character: number }; end: { line: number; character: number } }; severity?: number; message: string }> };
      this.diagnostics.set(p.uri, p.diagnostics.map(d => ({
        line: d.range.start.line, character: d.range.start.character,
        endLine: d.range.end.line, endCharacter: d.range.end.character,
        severity: d.severity ?? 1, message: d.message
      })));
      return;
    }
    const id = msg.id as number;
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    if (msg.error) pending.reject(new Error(JSON.stringify(msg.error)));
    else pending.resolve(msg.result);
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      this.child.stdin!.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    });
  }

  private notify(method: string, params: unknown): void {
    const body = JSON.stringify({ jsonrpc: '2.0', method, params });
    this.child.stdin!.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  }

  async initialize(): Promise<void> {
    await this.request('initialize', { processId: process.pid, rootUri: `file://${this.rootDir}`, capabilities: {}, workspaceFolders: [{ uri: `file://${this.rootDir}`, name: 'ws' }] });
    this.notify('initialized', {});
  }

  didOpen(uri: string, text: string): void {
    this.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'typescript', version: 1, text } });
  }

  didChange(uri: string, text: string, version: number): void {
    this.notify('textDocument/didChange', { textDocument: { uri, version }, contentChanges: [{ text }] });
  }

  pullDiagnostics(uri: string): LspDiagnostic[] {
    return this.diagnostics.get(uri) ?? [];
  }

  shutdown(): void {
    try { this.child.stdin!.end(); } catch { /* ignore */ }
    this.child.kill();
  }
}
