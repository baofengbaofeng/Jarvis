import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseTable, type Artifact } from '@jarvis/core/renderer';

// K6 (M8 Task 10): canvas workspace view. When a taskId is present it loads the
// task's captured artifacts (task_artifacts table) and renders each card by
// kind — tables through parseTable, everything else (markdown/mermaid/chart) as
// a JSON preview. Chart cards render as a JSON preview for now; the recharts
// integration is a documented post-M8 item. Without a taskId it shows the empty
// state (the same surface a /canvas route uses before a task is selected).
function TableCard({ content }: { content: string }) {
  const t = parseTable(content);
  return (
    <table data-testid="artifact-table"><thead><tr>{t.headers.map(h => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{t.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table>
  );
}

export function CanvasView({ taskId }: { taskId?: string }) {
  const { t } = useTranslation('common');
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  useEffect(() => {
    if (!taskId) { setArtifacts([]); return; }
    // Wrap in try/catch (Task 1 convention): an artifacts.list rejection must
    // degrade to the empty state, never an unhandled promise rejection.
    void (async () => {
      try {
        setArtifacts((await window.jarvis.invoke('artifacts.list', taskId)) as Artifact[]);
      } catch {
        setArtifacts([]);
      }
    })();
  }, [taskId]);
  return (
    <div className="canvas-grid" data-testid="canvas-view">
      {artifacts.map(a => (
        <div key={a.id} className="canvas-card" data-testid="canvas-card">
          <h4>{a.title ?? a.kind}</h4>
          {a.kind === 'table' && <TableCard content={a.content} />}
          {a.kind === 'markdown' && <pre data-testid="artifact-md">{a.content}</pre>}
          {a.kind === 'mermaid' && <pre data-testid="artifact-mermaid">{a.content}</pre>}
          {a.kind === 'chart' && <pre data-testid="artifact-chart">{a.content}</pre>}
        </div>
      ))}
      {artifacts.length === 0 && <div data-testid="canvas-empty">{t('canvas.no_artifacts')}</div>}
    </div>
  );
}
