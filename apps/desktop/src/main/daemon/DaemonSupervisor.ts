import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';

const DEFAULT_PORT = 17890;

export interface HealthPollerOptions {
  port: number;
  intervalMs: number;
  fetchImpl?: (url: string) => Promise<{ ok: boolean }>;
}

export function createHealthPoller(opts: HealthPollerOptions) {
  const fetchImpl = opts.fetchImpl ?? ((url: string) => fetch(url));
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  return {
    async start(onReady: () => void): Promise<void> {
      const url = `http://127.0.0.1:${opts.port}/health`;
      const tick = async () => {
        if (stopped) return;
        try {
          const res = await fetchImpl(url);
          if (res.ok) { onReady(); }
        } catch { /* not ready yet */ }
      };
      await tick();
      timer = setInterval(() => void tick(), opts.intervalMs);
    },
    stop(): void { stopped = true; if (timer) clearInterval(timer); }
  };
}

export class DaemonSupervisor {
  private child: ChildProcess | null = null;
  private poller: ReturnType<typeof createHealthPoller> | null = null;
  private port = Number(process.env.JARVIS_DAEMON_PORT ?? DEFAULT_PORT);
  private healthy = false;

  constructor(private binaryPath = join(import.meta.dirname, '../../../resources/daemon/jarvis-daemon')) {}

  start(onReady?: () => void, onExit?: () => void): void {
    if (this.child && !this.child.killed) return;
    this.child = spawn(this.binaryPath, [], { env: { ...process.env, JARVIS_DAEMON_PORT: String(this.port) } });
    this.child.on('error', () => { this.healthy = false; this.child = null; });
    this.poller = createHealthPoller({ port: this.port, intervalMs: 1000 });
    void this.poller.start(() => { this.healthy = true; onReady?.(); });
    this.child.on('exit', () => { this.healthy = false; onExit?.(); });
  }

  async status(): Promise<{ running: boolean; version: string; activeTasks: number }> {
    if (!this.healthy) return { running: false, version: 'unknown', activeTasks: 0 };
    try {
      const res = await fetch(`http://127.0.0.1:${this.port}/status`);
      return await res.json() as { running: boolean; version: string; activeTasks: number };
    } catch {
      return { running: false, version: 'unknown', activeTasks: 0 };
    }
  }

  restart(): void { this.stop(); this.start(); }
  stop(): void {
    this.poller?.stop();
    this.poller = null;
    this.child?.kill();
    this.child = null;
  }
}
