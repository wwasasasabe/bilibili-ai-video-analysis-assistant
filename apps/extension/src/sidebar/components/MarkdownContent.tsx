import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

interface MarkdownContentProps {
  source: string;
  className?: string;
  inline?: boolean;
}

export function normalizeMarkdownMath(source: string) {
  return source
    .replace(/\r\n/g, "\n")
    .replace(/\\\[((?:.|\n)+?)\\\]/g, (_, content: string) => `$$\n${content.trim()}\n$$`)
    .replace(/\\\(((?:.|\n)+?)\\\)/g, (_, content: string) => `$${content.trim()}$`);
}

export function MarkdownContent({
  source,
  className,
  inline = false
}: MarkdownContentProps) {
  const normalized = normalizeMarkdownMath(source);
  const rendered = (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        p: ({ children }) =>
          inline ? <span className="markdown-inline-paragraph">{children}</span> : <p>{children}</p>,
        pre: ({ children }) => <pre className="markdown-code-block">{children}</pre>,
        code: ({ children, className: codeClassName, ...props }) => {
          if (inline) {
            return (
              <code className={codeClassName} {...props}>
                {children}
              </code>
            );
          }

          return (
            <code className={codeClassName} {...props}>
              {children}
            </code>
          );
        }
      }}
    >
      {normalized}
    </ReactMarkdown>
  );

  if (inline) {
    return <span className={className}>{rendered}</span>;
  }

  return <div className={className}>{rendered}</div>;
}
