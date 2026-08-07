import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { InjectionApprovalClient } from './InjectionApprovalClient';

const DEFAULT_PORT = 17890;
// Fallbacks mirror daemon/cmd/jarvis-daemon/main.go getenvInt defaults.
const DEFAULT_CONCURRENCY_PER_AGENT = 6;
const DEFAULT_CONCURRENCY_MACHINE = 20;

export interface ConcurrencyConfig {
  perAgent?: number;
  machine?: number;
}

/** Prefer an explicit env token; otherwise mint a per-process secret for SEC-09. */
export function resolveDaemonAuthToken(env: NodeJS.ProcessEnv = process.env): string {
  const existing = env.JARVIS_DAEMON_TOKEN?.trim();
  if (existing) return existing;
  return randomBytes(32).toString('hex');
}

// Pure helper so the env wiring is unit-testable without spawning a process.
// The daemon reads JARVIS_CONCURRENCY_PER_AGENT / JARVIS_CONCURRENCY_MACHINE
// to size its queue (M3 Task 9, C10: closes the Task 8 deferral so the
// ConcurrencySettingsPage's save + daemon.restart actually takes effect).
// JARVIS_DAEMON_TOKEN is always set so /v1 injection-approval routes can auth.
export function buildDaemonEnv(
  base: NodeJS.ProcessEnv,
  port: number,
  concurrency: ConcurrencyConfig,
  token: string,
  coreEntry?: string,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...base,
    JARVIS_DAEMON_PORT: String(port),
    JARVIS_CONCURRENCY_PER_AGENT: String(concurrency.perAgent ?? DEFAULT_CONCURRENCY_PER_AGENT),
    JARVIS_CONCURRENCY_MACHINE: String(concurrency.machine ?? DEFAULT_CONCURRENCY_MACHINE),
    JARVIS_DAEMON_TOKEN: token,
  };
  if (coreEntry) {
    env.JARVIS_CORE_ENTRY = coreEntry;
  }
  return env;
}

export function daemonAuthHeaders(token: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
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
  let readyNotified = false;
  let wasHealthy = false;
  return {
    // DESK-17: onReady fires once; onUnhealthy fires when health flips false after ready.
    async start(onReady: () => void, onUnhealthy?: () => void): Promise<void> {
      const url = `http://127.0.0.1:${opts.port}/health`;
      const tick = async () => {
        if (stopped) return;
        try {
          const res = await fetchImpl(url);
          if (res.ok) {
            wasHealthy = true;
            if (!readyNotified) {
              readyNotified = true;
              onReady();
            }
          } else if (wasHealthy) {
            wasHealthy = false;
            onUnhealthy?.();
          }
        } catch {
          if (wasHealthy) {
            wasHealthy = false;
            onUnhealthy?.();
          }
        }
      };
      await tick();
      timer = setInterval(() => void tick(), opts.intervalMs);
    },
    stop(): void { stopped = true; if (timer) clearInterval(timer); }
  };
}

/** DESK-17: ignore stdio so a chatty daemon cannot fill unread pipes and deadlock. */
export function daemonSpawnOptions(): { stdio: 'ignore' } {
  return { stdio: 'ignore' };
}

// M7 Task 9 (L39 数据面): runtime status + L38 conflicts, cached by the
// supervisor's 3s poller so the IPC handlers answer without a per-call HTTP hop.
export interface RuntimeStatusData {
  registered: boolean;
  busy: boolean;
  activeTasks: number;
  lastHeartbeatAt: number;
  serverUrl: string;
  protocol: string;
  mode: 'local' | 'runtime_registered' | 'runtime_busy';
}

export interface ConflictItem {
  taskId: string;
  skill?: { name: string; localPath?: string; multicaPath?: string };
  mcp?: { name: string; localCommand?: string; multicaCommand?: string };
  resolved: boolean;
}

// Daemon unreachable (not started, errored, or exited) => local mode. The daemon
// itself does not report `mode`; it is derived from registered/busy here so the
// renderer IPC payload is already shaped for deriveMode.
const DEFAULT_RUNTIME_STATUS: RuntimeStatusData = {
  registered: false,
  busy: false,
  activeTasks: 0,
  lastHeartbeatAt: 0,
  serverUrl: '',
  protocol: '',
  mode: 'local',
};

export interface RuntimePollerOptions {
  port: number;
  intervalMs: number;
  authToken?: string;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
  onStatus: (data: RuntimeStatusData) => void;
  onConflicts: (items: ConflictItem[]) => void;
}

// Polls GET /runtime/status and GET /runtime/conflicts, mirroring
// createHealthPoller's pattern (start = immediate tick + setInterval). Each
// endpoint is handled independently: a daemon that answers status but not
// conflicts still refreshes the status cache.
export function createRuntimePoller(opts: RuntimePollerOptions) {
  const headers = daemonAuthHeaders(opts.authToken ?? '');
  const fetchImpl = opts.fetchImpl ?? ((url: string, init?: RequestInit) => fetch(url, { ...init, headers: { ...headers, ...init?.headers } }));
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const res = await fetchImpl(`http://127.0.0.1:${opts.port}/runtime/status`);
      if (res.ok) {
        const raw = await res.json() as Omit<RuntimeStatusData, 'mode'>;
        opts.onStatus({ ...raw, mode: !raw.registered ? 'local' : raw.busy ? 'runtime_busy' : 'runtime_registered' });
      }
    } catch { /* daemon not ready — cache keeps the default/local mode */ }
    try {
      const res = await fetchImpl(`http://127.0.0.1:${opts.port}/runtime/conflicts`);
      if (res.ok) {
        opts.onConflicts(await res.json() as ConflictItem[]);
      }
    } catch { /* daemon not ready — conflicts stay empty */ }
  };
  return {
    async start(): Promise<void> {
      await tick();
      timer = setInterval(() => void tick(), opts.intervalMs);
    },
    stop(): void { stopped = true; if (timer) clearInterval(timer); }
  };
}

export function defaultDaemonBinaryPath(
  dirname = import.meta.dirname,
  platform: NodeJS.Platform = process.platform,
  packaged = false,
  resourcesPath = typeof process.resourcesPath === 'string' ? process.resourcesPath : '',
): string {
  const name = platform === 'win32' ? 'jarvis-daemon.exe' : 'jarvis-daemon';
  if (packaged && resourcesPath) {
    return join(resourcesPath, 'daemon', name);
  }
  return join(dirname, '../../../resources/daemon', name);
}

/** Absolute path to packages/core/dist/headless.mjs (DAEM-01). */
export function defaultCoreEntryPath(
  dirname = import.meta.dirname,
  packaged = false,
  resourcesPath = typeof process.resourcesPath === 'string' ? process.resourcesPath : '',
): string {
  if (packaged && resourcesPath) {
    return join(resourcesPath, 'core', 'headless.mjs');
  }
  // apps/desktop/src/main/daemon -> repo root packages/core/dist/headless.mjs
  return join(dirname, '../../../../../packages/core/dist/headless.mjs');
}

export class DaemonSupervisor {
  private child: ChildProcess | null = null;
  private poller: ReturnType<typeof createHealthPoller> | null = null;
  private runtimePoller: ReturnType<typeof createRuntimePoller> | null = null;
  private port = Number(process.env.JARVIS_DAEMON_PORT ?? DEFAULT_PORT);
  private healthy = false;
  private concurrencyProvider: (() => ConcurrencyConfig) | null = null;
  private runtimeStatusCache: RuntimeStatusData = { ...DEFAULT_RUNTIME_STATUS };
  private conflictsCache: ConflictItem[] = [];
  /** Shared with the spawned daemon via JARVIS_DAEMON_TOKEN (SEC-09). */
  private readonly authToken: string = resolveDaemonAuthToken();
  private readonly coreEntryPath: string;

  constructor(
    private binaryPath = defaultDaemonBinaryPath(),
    coreEntryPath = defaultCoreEntryPath(),
  ) {
    this.coreEntryPath = coreEntryPath;
  }

  // C10: lets the main process hand the supervisor a live reader for the saved
  // settings.concurrency value, so every spawn/restart injects the current
  // limits into the daemon's env.
  setConcurrencyProvider(fn: () => ConcurrencyConfig): void {
    this.concurrencyProvider = fn;
  }

  private generation = 0;

  start(onReady?: () => void, onExit?: () => void): void {
    if (this.child && !this.child.killed) return;
    const gen = ++this.generation;
    this.child = spawn(this.binaryPath, [], {
      ...daemonSpawnOptions(),
      env: buildDaemonEnv(
        process.env,
        this.port,
        this.concurrencyProvider?.() ?? {},
        this.authToken,
        this.coreEntryPath,
      ),
    });
    const child = this.child;
    // DESK-17: ignore handlers from a previous generation after restart().
    child.on('error', () => {
      if (gen !== this.generation) return;
      this.healthy = false;
      this.resetRuntimeCache();
      if (this.child === child) this.child = null;
    });
    this.poller = createHealthPoller({ port: this.port, intervalMs: 1000 });
    void this.poller.start(
      () => {
        if (gen !== this.generation) return;
        this.healthy = true;
        onReady?.();
      },
      () => {
        if (gen !== this.generation) return;
        this.healthy = false;
      },
    );
    // M7 Task 9: cache L39 runtime status + L38 conflicts at 3s. The cache stays
    // at the local-mode default until the daemon answers, so a supervisor that
    // never starts still reports local mode via getRuntimeStatus().
    this.runtimePoller = createRuntimePoller({
      port: this.port,
      intervalMs: 3000,
      authToken: this.authToken,
      onStatus: (data) => { this.runtimeStatusCache = data; },
      onConflicts: (items) => { this.conflictsCache = items; },
    });
    void this.runtimePoller.start();
    child.on('exit', () => {
      if (gen !== this.generation) return;
      this.healthy = false;
      this.resetRuntimeCache();
      if (this.child === child) this.child = null;
      onExit?.();
    });
  }

  async status(): Promise<DaemonStatus> {
    if (!this.healthy) return UNKNOWN_STATUS;
    try {
      const res = await fetch(`http://127.0.0.1:${this.port}/status`, { headers: daemonAuthHeaders(this.authToken) });
      return await res.json() as DaemonStatus;
    } catch {
      return UNKNOWN_STATUS;
    }
  }

  getRuntimeStatus(): RuntimeStatusData { return { ...this.runtimeStatusCache }; }
  getRuntimeConflicts(): ConflictItem[] { return [...this.conflictsCache]; }

  injectionApprovalClient(): InjectionApprovalClient {
    return new InjectionApprovalClient(`http://127.0.0.1:${this.port}`, this.authToken);
  }

  private resetRuntimeCache(): void {
    this.runtimeStatusCache = { ...DEFAULT_RUNTIME_STATUS };
    this.conflictsCache = [];
  }

  restart(): void {
    this.stop();
    this.start();
  }
  stop(): void {
    this.generation += 1; // DESK-17: invalidate in-flight exit/error/health from the old child
    this.healthy = false;
    this.poller?.stop();
    this.poller = null;
    this.runtimePoller?.stop();
    this.runtimePoller = null;
    this.resetRuntimeCache();
    const child = this.child;
    this.child = null;
    child?.kill();
  }
}
