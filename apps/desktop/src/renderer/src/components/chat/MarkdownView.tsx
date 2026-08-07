import ReactMarkdown from 'react-markdown';

export function MarkdownView({ content }: { content: string }) {
  return (
    <ReactMarkdown
      components={{
        a({ href, children }) {
          if (!href) return <span>{children}</span>;
          try {
            if (new URL(href).protocol !== 'https:') return <span>{children}</span>;
          } catch {
            return <span>{children}</span>;
          }
          return <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>;
        },
        code({ className, children, node: _node, ...props }) {
          const match = /language-(\w+)/.exec(className ?? '');
          if (match) {
            return (
              <pre className="markdown-code-block">
                <code data-language={match[1]}>{String(children).replace(/\n$/, '')}</code>
              </pre>
            );
          }
          return <code className="markdown-code-inline" {...props}>{children}</code>;
        }
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
