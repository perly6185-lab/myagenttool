import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/cn";

// #1073 (Epic #1070): assistant output is GitHub-flavored Markdown — tables,
// bold, code — and rendered it must stay INERT. No rehype-raw: react-markdown
// drops raw-HTML nodes entirely, and its default urlTransform already neuters
// javascript: hrefs; the explicit override below keeps that guarantee local
// and visible instead of inherited. Wide content (tables, fenced code) scrolls
// inside its own container — the page never scrolls horizontally.

const SAFE_HREF = /^(https?:|mailto:|#|\/)/i;

export function MarkdownBlock({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("min-w-0 text-sm leading-relaxed [overflow-wrap:anywhere]", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: (props) => <p className="my-1.5 first:mt-0 last:mb-0" {...strip(props)} />,
          a: ({ href, ...props }) => (
            <a
              href={SAFE_HREF.test(href ?? "") ? href : undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary underline underline-offset-2"
              {...strip(props)}
            />
          ),
          ul: (props) => <ul className="my-1.5 list-disc space-y-0.5 pl-5" {...strip(props)} />,
          ol: (props) => <ol className="my-1.5 list-decimal space-y-0.5 pl-5" {...strip(props)} />,
          h1: (props) => <h1 className="mb-1.5 mt-3 text-base font-semibold first:mt-0" {...strip(props)} />,
          h2: (props) => <h2 className="mb-1.5 mt-3 text-base font-semibold first:mt-0" {...strip(props)} />,
          h3: (props) => <h3 className="mb-1 mt-2.5 text-sm font-semibold first:mt-0" {...strip(props)} />,
          blockquote: (props) => (
            <blockquote className="my-1.5 border-l-2 border-border pl-3 text-muted-foreground" {...strip(props)} />
          ),
          pre: (props) => (
            <pre className="my-1.5 overflow-x-auto rounded bg-muted/40 p-2 font-mono text-xs" {...strip(props)} />
          ),
          code: ({ className: codeClassName, ...props }) => (
            <code
              className={cn("rounded bg-muted/50 px-1 py-0.5 font-mono text-[0.85em] [pre_&]:bg-transparent [pre_&]:p-0", codeClassName)}
              {...strip(props)}
            />
          ),
          table: (props) => (
            <div className="my-1.5 max-w-full overflow-x-auto">
              <table className="w-max min-w-full border-collapse text-xs" {...strip(props)} />
            </div>
          ),
          th: (props) => (
            <th className="border border-border bg-muted/40 px-2 py-1 text-left font-semibold" {...strip(props)} />
          ),
          td: (props) => <td className="border border-border px-2 py-1 align-top" {...strip(props)} />,
          hr: (props) => <hr className="my-2 border-border" {...strip(props)} />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

// react-markdown hands each renderer a `node` (the hast node) that must not
// reach the DOM element, or React warns on an unknown attribute.
function strip<T extends { node?: unknown }>({ node: _node, ...props }: T) {
  return props;
}
