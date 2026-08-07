import { createStdioTransport, type McpTransport, type SpawnImpl } from './transport';

export interface MCPTool { name: string; description: string; inputSchema: Record<string, unknown> }

export interface McpClientDeps {
  spawnImpl?: SpawnImpl;
  /** CORE-08: per-request timeout in ms (default 30s). */
  requestTimeoutMs?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export class McpClient {
  private transport: McpTransport | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer?: ReturnType<typeof setTimeout> }>();
  private closed = false;
  private readonly requestTimeoutMs: number;

  constructor(private deps: McpClientDeps = {}, private serverName = 'mcp') {
    // Transport is created lazily (on first request or via attach()) so we
    // never spawn an empty command; production callers should use
    // createMcpClient() which supplies the real command/args through attach().
    this.requestTimeoutMs = deps.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  // Wire up response routing. Called by attach() and by ensureTransport()
  // for the test/DI path (`new McpClient({ spawnImpl })`).
  private wire(): void {
    this.transport!.onMessage((msg) => {
      const id = msg.id as number;
      const p = this.pending.get(id);
      if (!p) return;
      this.clearPending(id);
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

  private clearPending(id: number): void {
    const p = this.pending.get(id);
    if (!p) return;
    if (p.timer) clearTimeout(p.timer);
    this.pending.delete(id);
  }

  /** CORE-08: reject every in-flight request (close / child exit). */
  rejectAllPending(reason: string): void {
    const err = new Error(reason);
    for (const [id, p] of this.pending) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(err);
      this.pending.delete(id);
    }
  }

  private request(method: string, params: unknown): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error(`McpClient(${this.serverName}): closed`));
    this.ensureTransport();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.clearPending(id);
        reject(new Error(`McpClient(${this.serverName}): request timeout after ${this.requestTimeoutMs}ms (${method})`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.transport!.send({ jsonrpc: '2.0', id, method, params });
      } catch (e) {
        this.clearPending(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  async initialize(): Promise<void> {
    await this.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'jarvis', version: '1.0.0-Preview' } });
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
    if (this.closed) return;
    this.closed = true;
    // CORE-08: never leave callers hanging when the transport is torn down.
    this.rejectAllPending(`McpClient(${this.serverName}): closed`);
    if (this.transport) this.transport.close();
  }
}

export function createMcpClient(command: string, args: string[], serverName: string, deps: McpClientDeps = {}): McpClient {
  const client = new McpClient(deps, serverName);
  client.attach(createStdioTransport(command, args, deps.spawnImpl));
  return client;
}
