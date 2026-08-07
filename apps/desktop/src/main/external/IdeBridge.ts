import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { resolve, relative, isAbsolute } from 'node:path';

export interface IdeBridgeOptions {
  port?: number;
  token?: string;
  resolveFile: (rel: string) => string | null;
  resolveTaskDiff: (taskId: string) => { path: string; diff: string } | null;
}

export function resolveFileInWorkspace(rel: string, wsRoot: string): string | null {
  const root = resolve(wsRoot);
  const abs = resolve(root, rel);
  const r = relative(root, abs);
  if (r.startsWith('..') || isAbsolute(r)) return null;
  return abs;
}

export function mintIdeBridgeToken(): string {
  return randomBytes(32).toString('hex');
}

function unauthorized(res: ServerResponse): void {
  res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, error: 'UNAUTHORIZED' }));
}

export class IdeBridge {
  private server?: Server;
  readonly token: string;
  constructor(private opts: IdeBridgeOptions) {
    this.token = opts.token ?? mintIdeBridgeToken();
  }

  private authorized(req: IncomingMessage, port: number): boolean {
    const host = req.headers.host ?? '';
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return false;
    const auth = req.headers.authorization ?? '';
    const expected = `Bearer ${this.token}`;
    if (auth.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < auth.length; i++) diff |= auth.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
  }

  async start(): Promise<number> {
    const port = this.opts.port ?? 17891;
    this.server = createServer((req, res) => {
      if (!this.authorized(req, port)) {
        unauthorized(res);
        return;
      }
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      if (url.pathname === '/open') {
        const file = url.searchParams.get('file');
        const abs = file ? this.opts.resolveFile(file) : null;
        if (!abs) { res.writeHead(404).end('not found'); return; }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, path: abs }));
      } else if (url.pathname === '/diff') {
        const taskId = url.searchParams.get('task') ?? '';
        const d = this.opts.resolveTaskDiff(taskId);
        if (!d) { res.writeHead(404).end('not found'); return; }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(d));
      } else { res.writeHead(404).end(); }
    });
    await new Promise<void>((resolvePromise, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(port, '127.0.0.1', () => resolvePromise());
    });
    return port;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolvePromise) => this.server?.close(() => resolvePromise()));
  }
}

export function parseFileArg(spec: string): { file: string; line?: number } {
  const m = /^(.+?):(\d+)$/.exec(spec);
  return m ? { file: m[1], line: Number(m[2]) } : { file: spec };
}

export function openInExternalIde(cli: (args: string[]) => void, file: string, line?: number): void {
  cli(line != null ? ['-g', `${file}:${line}`] : [file]);
}
