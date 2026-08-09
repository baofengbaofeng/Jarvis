import type { AgentConfig } from '@jarvis/protocol';
import type { AgentEngine, EngineRunInput } from '../agent/AgentEngine';
import type { SandboxPolicy } from '../sandbox/Sandbox';
import type { ToolCall, ToolResult } from '../agent/types';
import type { ModelCapabilityFields } from '../model/capabilities';
import type { Usage } from '../model/types';
import { transition, type TaskState } from './TaskStateMachine';

export interface TaskStoreAdapter {
  create(id: string, agentId: string): Promise<void>;
  updateState(id: string, state: TaskState): Promise<void>;
  appendLog(id: string, line: string): Promise<void>;
}

export interface SubmitInput {
  id: string;
  agent: AgentConfig;
  messages: EngineRunInput['messages'];
  cwd: string;
  env: Record<string, string>;
  apiKey: string;
  provider: EngineRunInput['provider'];
  modelId: string;
  // Per-task sandbox root forwarded to tool contexts via EngineRunInput.
  workspaceRoot?: string;
  // Per-task sandbox policy forwarded to tool contexts via EngineRunInput
  // (C6/J6: the permissions UI's saved per-agent policy is enforced here).
  policy?: SandboxPolicy;
  // CORE-19: per-run tool visibility forwarded to EngineRunInput.
  visibleTools?: string[];
  // CORE-20: run-scoped MCP/agent tool authorization predicate.
  toolFilter?: (name: string) => boolean;
  modelCapabilities?: ModelCapabilityFields;
}

export interface TaskOrchestratorCallbacks {
  onStateChange?: (id: string, state: TaskState) => void;
  onLog?: (id: string, line: string) => void;
  onTool?: (id: string, call: ToolCall, result: ToolResult) => void;
  // B9: `usage` carries the run's aggregated token usage on the completion path
  // (undefined on the failure path). Optional so existing `onDone: () => ...`
  // callers stay backward compatible.
  onDone?: (id: string, ok: boolean, text: string, usage?: Usage | null) => void;
}

const DEFAULT_CONCURRENCY_PER_AGENT = 6;

interface PauseGate {
  paused: boolean;
  waiters: Array<() => void>;
}

export class TaskOrchestrator {
  private queue: Array<{ input: SubmitInput; controller: AbortController }> = [];
  private active = new Map<string, number>();   // agentId -> running count
  private states = new Map<string, TaskState>();
  private controllers = new Map<string, AbortController>();
  private inputs = new Map<string, SubmitInput>(); // persistent input store for retry
  // CORE-22: cooperative pause gates — engine.run awaits waitIfPaused between
  // model/tool steps so pause actually stops further work (not just a label).
  private pauseGates = new Map<string, PauseGate>();

  constructor(
    private engine: AgentEngine,
    private store: TaskStoreAdapter,
    private cb: TaskOrchestratorCallbacks = {},
    private perAgent: number = DEFAULT_CONCURRENCY_PER_AGENT
  ) {}

  submit(input: SubmitInput): void {
    this.inputs.set(input.id, input);
    this.states.set(input.id, 'queued');
    this.pauseGates.set(input.id, { paused: false, waiters: [] });
    this.queue.push({ input, controller: new AbortController() });
    this.controllers.set(input.id, this.queue[this.queue.length - 1].controller);
    this.cb.onStateChange?.(input.id, 'queued');
    void this.pump();
  }

  async cancel(id: string): Promise<void> {
    const controller = this.controllers.get(id);
    if (!controller) return;
    controller.abort();
    // Wake any pause waiters so the engine can observe the abort and exit.
    this.releasePause(id);
    const st = this.states.get(id);
    if (st === 'running' || st === 'paused') await this.store.updateState(id, transition(st, 'cancel'));
    this.states.set(id, 'cancelled');
    this.cb.onStateChange?.(id, 'cancelled');
  }

  async pause(id: string): Promise<void> {
    const st = this.states.get(id);
    if (st === 'running') {
      const gate = this.pauseGates.get(id) ?? { paused: false, waiters: [] };
      gate.paused = true;
      this.pauseGates.set(id, gate);
      this.states.set(id, 'paused');
      await this.store.updateState(id, 'paused');
      this.cb.onStateChange?.(id, 'paused');
    }
  }

  resume(id: string): void {
    if (this.states.get(id) === 'paused') {
      this.states.set(id, 'running');
      this.releasePause(id);
      this.cb.onStateChange?.(id, 'running');
    }
  }

  private releasePause(id: string): void {
    const gate = this.pauseGates.get(id);
    if (!gate) return;
    // Clear paused + flush waiters (resume or cancel).
    gate.paused = false;
    const waiters = gate.waiters.splice(0, gate.waiters.length);
    for (const w of waiters) w();
  }

  private waitIfPaused(id: string): Promise<void> {
    const gate = this.pauseGates.get(id);
    if (!gate || !gate.paused) return Promise.resolve();
    return new Promise<void>((resolve) => { gate.waiters.push(resolve); });
  }

  async retry(id: string): Promise<void> {
    const st = this.states.get(id);
    if (st !== 'failed' && st !== 'cancelled' && st !== 'completed') return;
    const input = this.inputs.get(id);
    if (!input) return;
    const controller = new AbortController();
    this.controllers.set(id, controller);
    this.pauseGates.set(id, { paused: false, waiters: [] });
    this.queue.push({ input, controller });
    this.states.set(id, 'queued');
    this.cb.onStateChange?.(id, 'queued');
    await this.pump();
  }

  private async pump(): Promise<void> {
    let progressed = true;
    while (progressed) {
      progressed = false;
      const idx = this.queue.findIndex((item) => {
        const st = this.states.get(item.input.id);
        const running = this.active.get(item.input.agent.id) ?? 0;
        return st === 'queued' && running < this.perAgent;
      });
      if (idx < 0) break;
      progressed = true;
      const item = this.queue.splice(idx, 1)[0];
      void this.runOne(item);
    }
  }

  private async runOne(item: { input: SubmitInput; controller: AbortController }): Promise<void> {
    const { input, controller } = item;
    const agentRunning = (this.active.get(input.agent.id) ?? 0) + 1;
    this.active.set(input.agent.id, agentRunning);
    try {
      await this.store.updateState(input.id, transition('queued', 'start'));
      // A cancel() that lands while the store write above was in flight set the
      // in-memory state to 'cancelled'. Bail out instead of overwriting it with
      // 'running' (which would then let the aborted engine run and fail).
      if (this.states.get(input.id) !== 'queued') return;
      this.states.set(input.id, 'running');
      this.cb.onStateChange?.(input.id, 'running');

      try {
        const result = await this.engine.run({
          ...input,
          signal: controller.signal,
          waitIfPaused: () => this.waitIfPaused(input.id),
          onDelta: (d) => { this.cb.onLog?.(input.id, d); void this.store.appendLog(input.id, d); },
          onTool: (call, toolResult) => { this.cb.onTool?.(input.id, call, toolResult); },
          onNotice: (code) => {
            this.cb.onLog?.(input.id, code);
            void this.store.appendLog(input.id, code);
          },
        });
        // A paused task that nevertheless finishes must still transition to a
        // terminal state and fire onDone, or it would hang forever.
        if (this.states.get(input.id) === 'running' || this.states.get(input.id) === 'paused') {
          const st = this.states.get(input.id) as 'running' | 'paused';
          await this.store.updateState(input.id, transition(st, 'complete'));
          this.states.set(input.id, 'completed');
          this.cb.onStateChange?.(input.id, 'completed');
          this.cb.onDone?.(input.id, true, result.text, result.usage);
        }
      } catch (e) {
        // A prior cancel() sets the state to 'cancelled'; never overwrite that
        // with a fail/complete transition (e.g. the AbortError from the signal).
        if (this.states.get(input.id) === 'running' || this.states.get(input.id) === 'paused') {
          const st = this.states.get(input.id) as 'running' | 'paused';
          const msg = e instanceof Error ? e.message : String(e);
          await this.store.updateState(input.id, transition(st, 'fail'));
          this.states.set(input.id, 'failed');
          this.cb.onStateChange?.(input.id, 'failed');
          this.cb.onDone?.(input.id, false, msg);
        }
      }
    } finally {
      this.pauseGates.delete(input.id);
      // Decrements even when we bailed out early on a queued-cancel race.
      this.active.set(input.agent.id, Math.max(0, (this.active.get(input.agent.id) ?? 0) - 1));
      void this.pump();
    }
  }
}
