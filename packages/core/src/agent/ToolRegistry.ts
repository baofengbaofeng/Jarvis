import type { ToolDef, ToolContext, ToolResult, ToolCall } from './types';

type ToolHandler = (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;

export class ToolRegistry {
  private tools = new Map<string, { def: ToolDef; handler: ToolHandler }>();

  register(def: ToolDef, handler: ToolHandler): void {
    this.tools.set(def.name, { def, handler });
  }

  list(): ToolDef[] { return [...this.tools.values()].map(t => t.def); }
  has(name: string): boolean { return this.tools.has(name); }

  async execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(call.name);
    if (!tool) throw new Error(`unknown tool: ${call.name}`);
    return tool.handler(call.arguments, ctx);
  }
}
