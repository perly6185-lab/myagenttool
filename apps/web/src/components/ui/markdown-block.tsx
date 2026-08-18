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

export function MarkdownBlock({
  text,
  className,
  variant = "compact",
  resolveImageSrc,
  imageUnavailableLabel = "Image unavailable",
}: {
  text: string;
  className?: string;
  variant?: "compact" | "document";
  resolveImageSrc?: (src: string) => string | null | undefined;
  imageUnavailableLabel?: string;
}) {
  const document = variant === "document";
  return (
    <div className={cn("min-w-0 [overflow-wrap:anywhere]", document ? "text-[15px] leading-7" : "text-sm leading-relaxed", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: (props) => <p className={document ? "my-3 first:mt-0 last:mb-0" : "my-1.5 first:mt-0 last:mb-0"} {...strip(props)} />,
          a: ({ href, ...props }) => (
            <a
              href={SAFE_HREF.test(href ?? "") ? href : undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary underline underline-offset-2"
              {...strip(props)}
            />
          ),
          ul: (props) => <ul className={document ? "my-3 list-disc space-y-1 pl-6" : "my-1.5 list-disc space-y-0.5 pl-5"} {...strip(props)} />,
          ol: (props) => <ol className={document ? "my-3 list-decimal space-y-1 pl-6" : "my-1.5 list-decimal space-y-0.5 pl-5"} {...strip(props)} />,
          h1: (props) => <h1 className={document ? "mb-4 mt-8 text-2xl font-bold leading-tight first:mt-0 sm:text-3xl" : "mb-1.5 mt-3 text-base font-semibold first:mt-0"} {...strip(props)} />,
          h2: (props) => <h2 className={document ? "mb-3 mt-8 border-b border-border pb-2 text-xl font-semibold first:mt-0" : "mb-1.5 mt-3 text-base font-semibold first:mt-0"} {...strip(props)} />,
          h3: (props) => <h3 className={document ? "mb-2 mt-6 text-lg font-semibold first:mt-0" : "mb-1 mt-2.5 text-sm font-semibold first:mt-0"} {...strip(props)} />,
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
          hr: (props) => <hr className={document ? "my-7 border-border" : "my-2 border-border"} {...strip(props)} />,
          img: ({ src, alt }) => {
            const resolved = resolveImageSrc ? resolveImageSrc(src ?? "") : src;
            return resolved ? (
              <img
                src={resolved}
                alt={alt ?? ""}
                loading="lazy"
                className={document ? "mx-auto my-5 max-h-[34rem] max-w-full rounded-lg border border-border object-contain" : "max-w-full"}
              />
            ) : (
              <span className="my-3 block rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground" role="img" aria-label={alt || imageUnavailableLabel}>
                {alt || imageUnavailableLabel}
              </span>
            );
          },
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
