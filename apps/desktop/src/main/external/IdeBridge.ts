import { createServer, type Server } from 'node:http';
import { resolve, relative, isAbsolute } from 'node:path';

export interface IdeBridgeOptions {
  port?: number;
  resolveFile: (rel: string) => string | null;
  resolveTaskDiff: (taskId: string) => { path: string; diff: string } | null;
}

// E12 containment: a localhost /open endpoint must NOT be able to read arbitrary
// files off disk, so the production wiring resolves the requested relative path
// against the workspace root and refuses anything that escapes it (same
// resolve/relative startsWith pattern as Sandbox.assertInside and
// mention.ts resolveFileMention). Returns null for paths outside the workspace.
export function resolveFileInWorkspace(rel: string, wsRoot: string): string | null {
  const root = resolve(wsRoot);
  const abs = resolve(root, rel);
  const r = relative(root, abs);
  if (r.startsWith('..') || isAbsolute(r)) return null;
  return abs;
}

export class IdeBridge {
  private server?: Server;
  constructor(private opts: IdeBridgeOptions) {}

  async start(): Promise<number> {
    const port = this.opts.port ?? 17891;
    this.server = createServer((req, res) => {
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
    await new Promise<void>((resolve) => this.server!.listen(port, '127.0.0.1', () => resolve()));
    return port;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }
}

export function parseFileArg(spec: string): { file: string; line?: number } {
  const m = /^(.+?):(\d+)$/.exec(spec);
  return m ? { file: m[1], line: Number(m[2]) } : { file: spec };
}

export function openInExternalIde(cli: (args: string[]) => void, file: string, line?: number): void {
  cli(line != null ? ['-g', `${file}:${line}`] : [file]);
}
