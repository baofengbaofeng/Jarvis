import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

export function MarkdownView({ content }: { content: string }) {
  return (
    <ReactMarkdown
      components={{
        a({ href, children }) {
          if (!href || new URL(href).protocol !== 'https:') return <span>{children}</span>;
          return <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>;
        },
        // react-markdown v9/v10 passes the unist `node` through ExtraProps;
        // it must be destructured out so spreading `...props` onto <code>
        // stays valid under strict JSX checking.
        code({ className, children, node: _node, ...props }) {
          const match = /language-(\w+)/.exec(className ?? '');
          return match ? (
            <SyntaxHighlighter style={oneDark} language={match[1]} PreTag="div">{String(children)}</SyntaxHighlighter>
          ) : (<code className={className} {...props}>{children}</code>);
        }
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
