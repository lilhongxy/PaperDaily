import ReactMarkdown from "react-markdown";
import { Link } from "react-router-dom";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

/** Models often emit \( \) / \[ \] delimiters; remark-math only understands $ / $$. */
function normalizeMath(s: string) {
  return s
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, m) => `\n$$\n${m}\n$$\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, m) => `$${m}$`);
}

export default function Markdown({ children, className = "" }: { children: string; className?: string }) {
  return (
    <div className={`prose-md ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a: ({ href = "", children, node: _n, ...rest }) =>
            href.startsWith("/") ? (
              <Link to={href} className="font-medium">
                {children}
              </Link>
            ) : (
              <a href={href} {...rest} target="_blank" rel="noreferrer">
                {children}
              </a>
            ),
        }}
      >
        {normalizeMath(children)}
      </ReactMarkdown>
    </div>
  );
}
