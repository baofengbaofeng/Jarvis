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
    this.tools.set(def.name, { def, handler });
  }

  list(): ToolDef[] { return [...this.tools.values()].map(t => t.def); }
  has(name: string): boolean { return this.tools.has(name); }

  async execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      this.opts.onExec?.({ ts: Date.now(), tool: call.name, args: call.arguments, result: 'error' });
      throw new Error(`unknown tool: ${call.name}`);
    }
    try {
      const result = await tool.handler(call.arguments, ctx);
      this.opts.onExec?.({ ts: Date.now(), tool: call.name, args: call.arguments, result: 'ok' });
      return result;
    } catch (err) {
      this.opts.onExec?.({ ts: Date.now(), tool: call.name, args: call.arguments, result: 'error' });
      throw err;
    }
  }
}
