import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decodeRpcFrame,
  encodeRpcFrame,
  hashPluginSource,
  type PluginDescriptor,
  type PluginPermission,
  type RegisteredPluginTool,
  type RpcMessage,
  type ToolContext,
  type ToolResult,
} from '@jarvis/core';
import {
  assertPluginSandboxExecArgv,
  buildPluginSandboxExecArgv,
} from './pluginSandboxPolicy';

export {
  assertPluginSandboxExecArgv,
  buildPluginSandboxExecArgv,
} from './pluginSandboxPolicy';

export interface UtilityChild {
  postMessage(message: unknown): void;
  kill(): boolean | void;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
  on(event: 'spawn', listener: () => void): unknown;
  removeListener?(event: string, listener: (...args: unknown[]) => void): unknown;
  off?(event: string, listener: (...args: unknown[]) => void): unknown;
}

export interface PluginForkOptions {
  execArgv: string[];
  env: Record<string, string>;
  serviceName?: string;
}

export interface PluginRunnerHostDeps {
  fork: (modulePath: string, args: string[], options: PluginForkOptions) => UtilityChild;
  approval: (descriptor: PluginDescriptor, hash: string) => Promise<boolean>;
  readSource?: (entryPath: string) => Promise<string>;
  childEntry?: string;
  startTimeoutMs?: number;
  invokeTimeoutMs?: number;
  /** When false, refuse to start any plugin process (fail closed). */
  sandboxAvailable?: boolean;
}

interface PendingCall {
  resolve: (result: ToolResult) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface LoadedPlugin {
  child: UtilityChild;
  tools: RegisteredPluginTool[];
  permissions: PluginPermission[];
  sourceHash: string;
}

const DEFAULT_START_MS = 2_000;
const DEFAULT_INVOKE_MS = 5_000;

function defaultChildEntry(): string {
  try {
    return join(dirname(fileURLToPath(import.meta.url)), 'plugin-runner-child.js');
  } catch {
    return join(__dirname, 'plugin-runner-child.js');
  }
}

function unwrapMessage(message: unknown): string {
  if (typeof message === 'string') return message;
  if (message && typeof message === 'object' && 'data' in message) {
    const data = (message as { data: unknown }).data;
    if (typeof data === 'string') return data;
  }
  throw new Error('PLUGIN_FRAME_INVALID');
}

export class PluginRunnerHost {
  private readonly plugins = new Map<string, LoadedPlugin>();
  private readonly pending = new Map<string, PendingCall>();
  private seq = 0;
  private readonly startTimeoutMs: number;
  private readonly invokeTimeoutMs: number;
  private readonly readSource: (entryPath: string) => Promise<string>;
  private readonly childEntry: string;
  private readonly sandboxAvailable: boolean;

  constructor(private readonly deps: PluginRunnerHostDeps) {
    this.startTimeoutMs = deps.startTimeoutMs ?? DEFAULT_START_MS;
    this.invokeTimeoutMs = deps.invokeTimeoutMs ?? DEFAULT_INVOKE_MS;
    this.readSource = deps.readSource ?? ((p) => readFile(p, 'utf8'));
    this.childEntry = deps.childEntry ?? defaultChildEntry();
    this.sandboxAvailable = deps.sandboxAvailable ?? true;
  }

  pendingCount(): number {
    return this.pending.size;
  }

  /** Synchronous liveness probe for main-process responsiveness after plugin faults. */
  probe(): { ok: true } {
    return { ok: true };
  }

  async load(descriptor: PluginDescriptor, approvedHash: string): Promise<RegisteredPluginTool[]> {
    if (!this.sandboxAvailable) {
      throw new Error('PLUGIN_SANDBOX_UNAVAILABLE');
    }
    if (approvedHash !== descriptor.sha256) {
      throw new Error('PLUGIN_APPROVAL_REQUIRED');
    }
    const approved = await this.deps.approval(descriptor, approvedHash);
    if (!approved) {
      throw new Error('PLUGIN_APPROVAL_REQUIRED');
    }

    const source = await this.readSource(descriptor.entryPath);
    const liveHash = hashPluginSource(source);
    if (liveHash !== approvedHash) {
      throw new Error('PLUGIN_APPROVAL_REQUIRED');
    }

    await this.close(descriptor.manifest.id);

    const execArgv = buildPluginSandboxExecArgv(this.childEntry);
    assertPluginSandboxExecArgv(execArgv);

    const child = this.deps.fork(this.childEntry, [], {
      execArgv,
      env: {},
      serviceName: `jarvis-plugin:${descriptor.manifest.id}`,
    });

    const tools: RegisteredPluginTool[] = [];
    const permissions = [...descriptor.manifest.permissions];
    const sourceFrame = encodeRpcFrame({
      type: 'source',
      code: source,
      manifest: descriptor.manifest,
      permissions,
    });

    try {
      await this.waitForReady(child, tools, sourceFrame);
    } catch (err) {
      try { child.kill(); } catch { /* ignore */ }
      throw err;
    }

    child.on('message', (raw) => this.onChildMessage(descriptor.manifest.id, raw));
    child.on('exit', () => this.onChildGone(descriptor.manifest.id, 'PLUGIN_CRASHED'));
    child.on('error', () => this.onChildGone(descriptor.manifest.id, 'PLUGIN_CRASHED'));

    this.plugins.set(descriptor.manifest.id, {
      child,
      tools: [...tools],
      permissions,
      sourceHash: liveHash,
    });
    return tools;
  }

  async invoke(
    pluginId: string,
    tool: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) throw new Error('PLUGIN_NOT_LOADED');

    const id = `c${++this.seq}`;
    const frame = encodeRpcFrame({
      type: 'invoke',
      id,
      tool,
      args,
      context: {
        cwd: ctx.cwd,
        workspaceRoot: ctx.workspaceRoot,
        permissions: plugin.permissions,
      },
    });

    return new Promise<ToolResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.rejectAllPending(new Error('PLUGIN_TIMEOUT'));
        try { plugin.child.kill(); } catch { /* ignore */ }
        this.plugins.delete(pluginId);
      }, this.invokeTimeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      try {
        plugin.child.postMessage(frame);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  async close(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;
    this.plugins.delete(pluginId);
    try {
      plugin.child.postMessage(encodeRpcFrame({ type: 'shutdown' }));
    } catch { /* ignore */ }
    try { plugin.child.kill(); } catch { /* ignore */ }
  }

  async closeAll(): Promise<void> {
    const ids = [...this.plugins.keys()];
    await Promise.all(ids.map((id) => this.close(id)));
    this.rejectAllPending(new Error('PLUGIN_SHUTDOWN'));
  }

  private waitForReady(
    child: UtilityChild,
    tools: RegisteredPluginTool[],
    sourceFrame: string,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        detach();
        try { child.kill(); } catch { /* ignore */ }
        reject(new Error('PLUGIN_START_TIMEOUT'));
      }, this.startTimeoutMs);

      const onMessage = (raw: unknown) => {
        try {
          const msg = decodeRpcFrame(unwrapMessage(raw));
          if (msg.type === 'sandbox' && !msg.available) {
            detach();
            try { child.kill(); } catch { /* ignore */ }
            reject(new Error('PLUGIN_SANDBOX_UNAVAILABLE'));
            return;
          }
          if (msg.type === 'register') {
            for (const def of msg.tools) tools.push({ definition: def });
            return;
          }
          if (msg.type === 'ready') {
            detach();
            resolve();
            return;
          }
          if (msg.type === 'error') {
            detach();
            try { child.kill(); } catch { /* ignore */ }
            reject(new Error(msg.code || 'PLUGIN_ERROR'));
          }
        } catch (err) {
          detach();
          try { child.kill(); } catch { /* ignore */ }
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      };

      const onExit = () => {
        detach();
        reject(new Error('PLUGIN_CRASHED'));
      };

      const onError = (err: Error) => {
        detach();
        reject(err);
      };

      const detach = () => {
        clearTimeout(timer);
        child.removeListener?.('message', onMessage as never);
        child.off?.('message', onMessage as never);
        child.removeListener?.('exit', onExit as never);
        child.off?.('exit', onExit as never);
        child.removeListener?.('error', onError as never);
        child.off?.('error', onError as never);
      };

      child.on('message', onMessage);
      child.on('exit', onExit);
      child.on('error', onError);
      child.postMessage(sourceFrame);
    });
  }

  private onChildMessage(pluginId: string, raw: unknown): void {
    let text: string;
    try {
      text = unwrapMessage(raw);
    } catch (err) {
      this.onChildGone(pluginId, err instanceof Error ? err.message : 'PLUGIN_FRAME_INVALID');
      return;
    }

    let msg: RpcMessage;
    try {
      msg = decodeRpcFrame(text);
    } catch (err) {
      this.rejectAllPending(err instanceof Error ? err : new Error(String(err)));
      const plugin = this.plugins.get(pluginId);
      try { plugin?.child.kill(); } catch { /* ignore */ }
      this.plugins.delete(pluginId);
      return;
    }

    if (msg.type === 'result') {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(msg.id);
      pending.resolve(msg.result);
      return;
    }
    if (msg.type === 'error') {
      if (msg.id) {
        const pending = this.pending.get(msg.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(msg.id);
          pending.reject(new Error(msg.code || msg.message));
        }
        return;
      }
      this.onChildGone(pluginId, msg.code || 'PLUGIN_ERROR');
    }
  }

  private onChildGone(pluginId: string, code: string): void {
    this.plugins.delete(pluginId);
    this.rejectAllPending(new Error(code));
  }

  private rejectAllPending(err: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }
}

export function createElectronPluginRunnerHost(
  approval: PluginRunnerHostDeps['approval'],
  opts: Partial<PluginRunnerHostDeps> = {},
): PluginRunnerHost {
  try {
    const require = createRequire(import.meta.url);
    const electron = require('electron') as {
      utilityProcess?: { fork: (m: string, a: string[], o: PluginForkOptions) => UtilityChild };
    };
    const utilityProcess = electron.utilityProcess;
    if (!utilityProcess?.fork) {
      throw new Error('missing utilityProcess.fork');
    }
    return new PluginRunnerHost({
      fork: (modulePath, args, options) => utilityProcess.fork(modulePath, args, options),
      approval,
      sandboxAvailable: true,
      ...opts,
    });
  } catch {
    return new PluginRunnerHost({
      fork: () => {
        throw new Error('PLUGIN_SANDBOX_UNAVAILABLE');
      },
      approval,
      sandboxAvailable: false,
      ...opts,
    });
  }
}

let _pluginRunner: PluginRunnerHost | null = null;

/** Lazy singleton for main bootstrap / will-quit cleanup. */
export function getPluginRunner(): PluginRunnerHost {
  if (!_pluginRunner) {
    _pluginRunner = createElectronPluginRunnerHost(async () => false);
  }
  return _pluginRunner;
}

/** @deprecated prefer getPluginRunner(); kept for will-quit call sites */
export const pluginRunner = {
  closeAll: () => getPluginRunner().closeAll(),
};
