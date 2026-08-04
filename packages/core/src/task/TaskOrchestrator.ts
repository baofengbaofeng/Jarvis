import type { AgentConfig } from '@jarvis/protocol';
import type { AgentEngine, EngineRunInput } from '../agent/AgentEngine';
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
}

export interface TaskOrchestratorCallbacks {
  onStateChange?: (id: string, state: TaskState) => void;
  onLog?: (id: string, line: string) => void;
  onDone?: (id: string, ok: boolean, text: string) => void;
}

const DEFAULT_CONCURRENCY_PER_AGENT = 6;

export class TaskOrchestrator {
  private queue: Array<{ input: SubmitInput; controller: AbortController }> = [];
  private active = new Map<string, number>();   // agentId -> running count
  private states = new Map<string, TaskState>();
  private controllers = new Map<string, AbortController>();
  private inputs = new Map<string, SubmitInput>(); // persistent input store for retry

  constructor(
    private engine: AgentEngine,
    private store: TaskStoreAdapter,
    private cb: TaskOrchestratorCallbacks = {},
    private perAgent: number = DEFAULT_CONCURRENCY_PER_AGENT
  ) {}

  submit(input: SubmitInput): void {
    this.inputs.set(input.id, input);
    this.states.set(input.id, 'queued');
    this.queue.push({ input, controller: new AbortController() });
    this.controllers.set(input.id, this.queue[this.queue.length - 1].controller);
    this.cb.onStateChange?.(input.id, 'queued');
    void this.pump();
  }

  async cancel(id: string): Promise<void> {
    const controller = this.controllers.get(id);
    if (!controller) return;
    controller.abort();
    const st = this.states.get(id);
    if (st === 'running') await this.store.updateState(id, transition(st, 'cancel'));
    this.states.set(id, 'cancelled');
    this.cb.onStateChange?.(id, 'cancelled');
  }

  pause(id: string): void {
    const st = this.states.get(id);
    if (st === 'running') { this.states.set(id, 'paused'); this.cb.onStateChange?.(id, 'paused'); }
  }

  resume(id: string): void {
    if (this.states.get(id) === 'paused') { this.states.set(id, 'running'); this.cb.onStateChange?.(id, 'running'); }
  }

  async retry(id: string): Promise<void> {
    const st = this.states.get(id);
    if (st !== 'failed' && st !== 'cancelled' && st !== 'completed') return;
    const input = this.inputs.get(id);
    if (!input) return;
    const controller = new AbortController();
    this.controllers.set(id, controller);
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
    await this.store.updateState(input.id, transition('queued', 'start'));
    this.states.set(input.id, 'running');
    this.cb.onStateChange?.(input.id, 'running');

    try {
      const result = await this.engine.run({ ...input, signal: controller.signal, onDelta: (d) => { this.cb.onLog?.(input.id, d); void this.store.appendLog(input.id, d); } });
      await this.store.updateState(input.id, transition('running', 'complete'));
      this.states.set(input.id, 'completed');
      this.cb.onStateChange?.(input.id, 'completed');
      this.cb.onDone?.(input.id, true, result.text);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.store.updateState(input.id, transition('running', 'fail'));
      this.states.set(input.id, 'failed');
      this.cb.onStateChange?.(input.id, 'failed');
      this.cb.onDone?.(input.id, false, msg);
    } finally {
      this.active.set(input.agent.id, Math.max(0, (this.active.get(input.agent.id) ?? 0) - 1));
      void this.pump();
    }
  }
}
