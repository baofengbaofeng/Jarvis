import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface McpTransport {
  send(msg: Record<string, unknown>): void;
  onMessage(cb: (msg: Record<string, unknown>) => void): void;
  close(): void;
}

export interface SpawnImpl { (command: string, args: string[], opts: unknown): ChildProcess }

export interface StdioTransportOpts {
  /** CORE-09: called when the child emits `error` (e.g. spawn ENOENT). */
  onError?: (err: Error) => void;
  /** Called when the child exits or the transport is closed. */
  onClose?: (info: { code: number | null; signal: NodeJS.Signals | null }) => void;
}

export function createStdioTransport(
  command: string,
  args: string[],
  spawnImpl: SpawnImpl = spawn as unknown as SpawnImpl,
  opts: StdioTransportOpts = {},
): McpTransport {
  const child = spawnImpl(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  const rl = createInterface({ input: child.stdout! });
  // CORE-09: always drain stderr. An unread stderr pipe fills its buffer and
  // deadlocks the child when it writes diagnostics; also surface lines via
  // the error callback when they look fatal, otherwise discard.
  if (child.stderr) {
    const errRl = createInterface({ input: child.stderr });
    errRl.on('line', () => { /* drain */ });
    errRl.on('error', () => { /* ignore reader errors */ });
  }
  // CORE-09: an unhandled `error` on ChildProcess can crash Electron main.
  // Guard `.on` so lightweight test doubles without EventEmitter still work.
  if (typeof child.on === 'function') {
    child.on('error', (err: Error) => {
      try { opts.onError?.(err); } catch { /* never rethrow into the event loop */ }
    });
    child.on('exit', (code, signal) => {
      try { opts.onClose?.({ code, signal }); } catch { /* best-effort */ }
    });
  }
  return {
    send(msg) {
      try {
        child.stdin!.write(JSON.stringify(msg) + '\n');
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        try { opts.onError?.(err); } catch { /* ignore */ }
      }
    },
    onMessage(cb) { rl.on('line', (line) => { try { cb(JSON.parse(line)); } catch { /* ignore */ } }); },
    close() {
      try { child.stdin!.end(); } catch { /* ignore */ }
      try { child.kill(); } catch { /* ignore */ }
    }
  };
}
