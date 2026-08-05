export interface CallEdge { id: string; from: string; to: string; taskId?: string; ok: boolean; ts: number }
export interface GraphRow { from: string; to: string; label: string }

export class CallGraph {
  private edges: CallEdge[] = [];
  constructor(private now: () => number = () => Date.now()) {}

  addEdge(from: string, to: string, opts: { taskId?: string; ok?: boolean } = {}): CallEdge {
    const e: CallEdge = { id: `${from}->${to}#${opts.taskId ?? ''}-${this.edges.length}`, from, to, taskId: opts.taskId, ok: opts.ok ?? true, ts: this.now() };
    this.edges.push(e);
    return e;
  }

  getEdges(): CallEdge[] { return [...this.edges]; }

  toRows(): GraphRow[] {
    return this.edges.map(e => ({ from: e.from, to: e.to, label: e.ok ? 'ok' : 'failed' }));
  }
}

export function detectCycle(edges: CallEdge[]): boolean {
  const seen = new Set<string>();
  for (const e of edges) {
    const k = `${e.from}->${e.to}#${e.taskId ?? ''}`;
    if (seen.has(k)) return true;
    seen.add(k);
  }
  return false;
}
