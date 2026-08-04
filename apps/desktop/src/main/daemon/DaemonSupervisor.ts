import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';

const DEFAULT_PORT = 17890;
// Fallbacks mirror daemon/cmd/jarvis-daemon/main.go getenvInt defaults.
const DEFAULT_CONCURRENCY_PER_AGENT = 6;
const DEFAULT_CONCURRENCY_MACHINE = 20;

export interface ConcurrencyConfig {
  perAgent?: number;
  machine?: number;
}

// Pure helper so the env wiring is unit-testable without spawning a process.
// The daemon reads JARVIS_CONCURRENCY_PER_AGENT / JARVIS_CONCURRENCY_MACHINE
// to size its queue (M3 Task 9, C10: closes the Task 8 deferral so the
// ConcurrencySettingsPage's save + daemon.restart actually takes effect).
export function buildDaemonEnv(base: NodeJS.ProcessEnv, port: number, concurrency: ConcurrencyConfig): NodeJS.ProcessEnv {
  return {
    ...base,
    JARVIS_DAEMON_PORT: String(port),
    JARVIS_CONCURRENCY_PER_AGENT: String(concurrency.perAgent ?? DEFAULT_CONCURRENCY_PER_AGENT),
    JARVIS_CONCURRENCY_MACHINE: String(concurrency.machine ?? DEFAULT_CONCURRENCY_MACHINE)
  };
}

export interface DaemonStatus {
  running: boolean;
  version: string;
  activeTasks: number;
  queued: number;
  perAgent: number;
  concurrency: number;
}

const UNKNOWN_STATUS: DaemonStatus = { running: false, version: 'unknown', activeTasks: 0, queued: 0, perAgent: 0, concurrency: 0 };

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
  private concurrencyProvider: (() => ConcurrencyConfig) | null = null;

  constructor(private binaryPath = join(import.meta.dirname, '../../../resources/daemon/jarvis-daemon')) {}

  // C10: lets the main process hand the supervisor a live reader for the saved
  // settings.concurrency value, so every spawn/restart injects the current
  // limits into the daemon's env.
  setConcurrencyProvider(fn: () => ConcurrencyConfig): void {
    this.concurrencyProvider = fn;
  }

  start(onReady?: () => void, onExit?: () => void): void {
    if (this.child && !this.child.killed) return;
    this.child = spawn(this.binaryPath, [], { env: buildDaemonEnv(process.env, this.port, this.concurrencyProvider?.() ?? {}) });
    this.child.on('error', () => { this.healthy = false; this.child = null; });
    this.poller = createHealthPoller({ port: this.port, intervalMs: 1000 });
    void this.poller.start(() => { this.healthy = true; onReady?.(); });
    this.child.on('exit', () => { this.healthy = false; onExit?.(); });
  }

  async status(): Promise<DaemonStatus> {
    if (!this.healthy) return UNKNOWN_STATUS;
    try {
      const res = await fetch(`http://127.0.0.1:${this.port}/status`);
      return await res.json() as DaemonStatus;
    } catch {
      return UNKNOWN_STATUS;
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
