import { useEffect, useState } from 'react';
import ReactFlow, { type Edge, type Node } from 'reactflow';
import 'reactflow/dist/style.css';

// L14 (M6 Task 10): the delegation call chain as a react-flow graph. rows are
// squad.graph's { from, to, label } edges (leader -> member delegations + the
// ok/failed label); each unique agent becomes a node, each row an edge. The
// pure CallGraph/detectCycle logic lives in core; this view only renders.
export function CallGraphView({ rows }: { rows: Array<{ from: string; to: string; label: string }> }) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  useEffect(() => {
    const agents = [...new Set(rows.flatMap(r => [r.from, r.to]))];
    setNodes(agents.map((a, i) => ({ id: a, position: { x: i * 160, y: 40 }, data: { label: a } })));
    setEdges(rows.map((r, i) => ({ id: `e${i}`, source: r.from, target: r.to, label: r.label })));
  }, [rows]);
  return <div data-testid="call-graph" className="call-graph"><ReactFlow nodes={nodes} edges={edges} fitView /></div>;
}
