import type { ToolDef, ToolContext, ToolResult, ToolCall } from './types';

type ToolHandler = (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;

// J5 (M8 Task 3): execution-audit hook. Fired once per execute() attempt — with
// result 'ok' when the handler resolves, 'error' when it rejects or the tool is
// unknown. The 'denied' result is emitted by the caller (the approval gate), not
// here: ToolRegistry has no sandbox/permission concept inside execute().
export interface ToolExecEntry { ts: number; tool: string; args: unknown; result: 'ok' | 'denied' | 'error' }
export interface ToolRegistryOpts { onExec?: (e: ToolExecEntry) => void }

export class ToolRegistry {
  private tools = new Map<string, { def: ToolDef; handler: ToolHandler }>();
  constructor(private opts: ToolRegistryOpts = {}) {}

  register(def: ToolDef, handler: ToolHandler): void {
    // CORE-07: refuse silent overwrite — plugins must not shadow builtins.
    if (this.tools.has(def.name)) {
      throw new Error(`tool already registered: ${def.name}`);
    }
    this.tools.set(def.name, { def, handler });
  }

  /** CORE-07: remove a tool by name; returns true if it was present. */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  list(): ToolDef[] { return [...this.tools.values()].map(t => t.def); }
  has(name: string): boolean { return this.tools.has(name); }
  get(name: string): ToolDef | undefined { return this.tools.get(name)?.def; }

  async execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
    // M8 final review: onExec is best-effort telemetry (the audit sink). A hook
    // throw must never flip a successful tool call into an error, so every
    // dispatch is wrapped — the tool outcome below is the single source of truth.
    const emit = (result: 'ok' | 'error') => {
      try { this.opts.onExec?.({ ts: Date.now(), tool: call.name, args: call.arguments, result }); } catch { /* best-effort audit */ }
    };
    const tool = this.tools.get(call.name);
    if (!tool) {
      emit('error');
      // CORE-06: unknown tools are model-recoverable failures, not task killers.
      return { ok: false, output: `unknown tool: ${call.name}` };
    }
    try {
      const result = await tool.handler(call.arguments, ctx);
      emit('ok');
      return result;
    } catch (err) {
      emit('error');
      // CORE-06: handler throws must return ok:false to the model so the REACT
      // loop can continue, instead of aborting the whole task.
      const output = err instanceof Error ? err.message : String(err);
      return { ok: false, output };
    }
  }
}
