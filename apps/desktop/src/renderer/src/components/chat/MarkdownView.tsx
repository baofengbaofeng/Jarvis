import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism/one-dark';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism/one-light';
import { useTheme } from '../theme/theme-store';

export function MarkdownView({ content }: { content: string }) {
  const mode = useTheme((s) => s.mode);
  const resolved = useTheme((s) => s.resolved);
  const theme = resolved(mode);
  const codeStyle = theme === 'dark' ? oneDark : oneLight;

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
              <SyntaxHighlighter style={codeStyle} language={match[1]} PreTag="div">
                {String(children).replace(/\n$/, '')}
              </SyntaxHighlighter>
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
