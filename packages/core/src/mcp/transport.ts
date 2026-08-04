import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface McpTransport {
  send(msg: Record<string, unknown>): void;
  onMessage(cb: (msg: Record<string, unknown>) => void): void;
  close(): void;
}

export interface SpawnImpl { (command: string, args: string[], opts: unknown): ChildProcess }

export function createStdioTransport(command: string, args: string[], spawnImpl: SpawnImpl = spawn as unknown as SpawnImpl): McpTransport {
  const child = spawnImpl(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  const rl = createInterface({ input: child.stdout! });
  return {
    send(msg) { child.stdin!.write(JSON.stringify(msg) + '\n'); },
    onMessage(cb) { rl.on('line', (line) => { try { cb(JSON.parse(line)); } catch { /* ignore */ } }); },
    close() { try { child.stdin!.end(); } catch { /* ignore */ } child.kill(); }
  };
}
