import { createStdioTransport, type McpTransport, type SpawnImpl } from './transport';

export interface MCPTool { name: string; description: string; inputSchema: Record<string, unknown> }

export interface McpClientDeps { spawnImpl?: SpawnImpl }

export class McpClient {
  private transport: McpTransport | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  constructor(private deps: McpClientDeps = {}, private serverName = 'mcp') {
    // Transport is created lazily (on first request or via attach()) so we
    // never spawn an empty command; production callers should use
    // createMcpClient() which supplies the real command/args through attach().
  }

  // Wire up response routing. Called by attach() and by ensureTransport()
  // for the test/DI path (`new McpClient({ spawnImpl })`).
  private wire(): void {
    this.transport!.onMessage((msg) => {
      const id = msg.id as number;
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    });
  }

  attach(transport: McpTransport): void {
    this.transport = transport;
    this.wire();
  }

  private ensureTransport(): void {
    if (this.transport) return;
    if (!this.deps.spawnImpl) {
      throw new Error(`McpClient(${this.serverName}): no transport attached — use createMcpClient(command, args, serverName) or attach(transport)`);
    }
    this.transport = createStdioTransport('', [], this.deps.spawnImpl);
    this.wire();
  }

  private request(method: string, params: unknown): Promise<unknown> {
    this.ensureTransport();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.transport!.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  async initialize(): Promise<void> {
    await this.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'jarvis', version: '0.1.0' } });
  }

  async listTools(): Promise<MCPTool[]> {
    const r = (await this.request('tools/list', {})) as { tools: MCPTool[] };
    return r.tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const r = (await this.request('tools/call', { name, arguments: args })) as { content?: Array<{ type: string; text?: string }>; isError?: boolean };
    const text = (r.content ?? []).filter(c => c.text).map(c => c.text).join('\n');
    if (r.isError) throw new Error(text || 'mcp tool error');
    return text;
  }

  close(): void {
    if (this.transport) this.transport.close();
  }
}

export function createMcpClient(command: string, args: string[], serverName: string, deps: { spawnImpl?: SpawnImpl } = {}): McpClient {
  const client = new McpClient(deps, serverName);
  client.attach(createStdioTransport(command, args, deps.spawnImpl));
  return client;
}
