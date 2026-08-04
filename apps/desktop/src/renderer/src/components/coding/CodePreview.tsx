export function CodePreview({ path, code }: { path: string; code: string }) {
  return (
    <div data-testid="code-preview" className="code-preview">
      <div className="code-preview__path">{path}</div>
      <pre><code>{code}</code></pre>
    </div>
  );
}
