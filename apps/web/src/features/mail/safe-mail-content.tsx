import { useMemo, type ReactNode } from "react";
import { cn } from "@/lib/cn";

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const ALLOWED_TAGS = new Set([
  "a", "abbr", "address", "article", "aside", "b", "blockquote", "br", "caption", "code", "col", "colgroup",
  "dd", "del", "details", "div", "dl", "dt", "em", "figcaption", "figure", "footer", "h1", "h2", "h3", "h4",
  "h5", "h6", "header", "hr", "i", "img", "li", "main", "mark", "ol", "p", "pre", "q", "s", "section", "small",
  "span", "strong", "sub", "summary", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul",
]);
const DROP_WITH_CONTENT = new Set(["applet", "audio", "base", "button", "canvas", "embed", "form", "frame", "frameset", "head", "iframe", "input", "link", "meta", "noscript", "object", "script", "select", "source", "style", "svg", "textarea", "video"]);
const GLOBAL_ATTRIBUTES = new Set(["dir", "lang", "title"]);

export function PlainMailBody({ body, className }: { body: string; className?: string }) {
  return <div className={cn("whitespace-pre-wrap break-words text-sm leading-7", className)}>{linkifyMailText(body)}</div>;
}

export function SafeHtmlMailBody({
  html,
  title,
  allowRemoteImages,
  cidImages,
  className,
}: {
  html: string;
  title: string;
  allowRemoteImages: boolean;
  cidImages: Record<string, string>;
  className?: string;
}) {
  const srcDoc = useMemo(
    () => sanitizeMailHtml(html, { allowRemoteImages, cidImages }),
    [allowRemoteImages, cidImages, html],
  );
  return <iframe title={title} srcDoc={srcDoc} sandbox="allow-popups allow-popups-to-escape-sandbox" className={cn("min-h-[26rem] w-full rounded-lg border bg-white", className)} />;
}

export function linkifyMailText(value: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let cursor = 0;
  let index = 0;
  for (const match of value.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    const raw = match[0];
    const url = trimUrlEnd(raw);
    if (start > cursor) parts.push(value.slice(cursor, start));
    if (safeHttpUrl(url)) {
      parts.push(<a key={`mail-url-${index}`} href={url} target="_blank" rel="noopener noreferrer" className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary">{url}</a>);
    } else {
      parts.push(url);
    }
    if (url.length < raw.length) parts.push(raw.slice(url.length));
    cursor = start + raw.length;
    index += 1;
  }
  if (cursor < value.length) parts.push(value.slice(cursor));
  return parts;
}

export function sanitizeMailHtml(
  value: string,
  { allowRemoteImages = false, cidImages = {} }: { allowRemoteImages?: boolean; cidImages?: Record<string, string> } = {},
) {
  const parsed = new DOMParser().parseFromString(value, "text/html");
  const body = parsed.body;
  for (const element of Array.from(body.querySelectorAll("*"))) sanitizeElement(parsed, element, allowRemoteImages, cidImages);
  const imagePolicy = allowRemoteImages ? "img-src data: https: http:;" : "img-src data:;";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; ${imagePolicy} style-src 'unsafe-inline'; font-src 'none'; media-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>html{color-scheme:light}body{box-sizing:border-box;margin:0;padding:16px;color:#202124;background:#fff;font:14px/1.6 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%;border-collapse:collapse}th,td{padding:6px;border:1px solid #d8dce2;vertical-align:top}pre{white-space:pre-wrap}blockquote{margin-left:0;padding-left:12px;border-left:3px solid #d8dce2;color:#5f6368}a{color:#155eef}.mat-link-host{font-size:12px;color:#5f6368}.mat-blocked-image{display:inline-block;padding:4px 8px;border:1px dashed #c3c8d0;border-radius:4px;color:#5f6368;background:#f7f8fa;font-size:12px}</style></head><body>${body.innerHTML}</body></html>`;
}

function sanitizeElement(document: Document, element: Element, allowRemoteImages: boolean, cidImages: Record<string, string>) {
  const tag = element.tagName.toLowerCase();
  if (DROP_WITH_CONTENT.has(tag)) {
    element.remove();
    return;
  }
  if (!ALLOWED_TAGS.has(tag)) {
    element.replaceWith(...Array.from(element.childNodes));
    return;
  }

  const originalAttributes = new Map(Array.from(element.attributes).map((attribute) => [attribute.name.toLowerCase(), attribute.value]));
  for (const attribute of Array.from(element.attributes)) element.removeAttribute(attribute.name);
  for (const name of GLOBAL_ATTRIBUTES) {
    const original = originalAttributes.get(name);
    if (original) element.setAttribute(name, original.slice(0, 500));
  }

  if (tag === "a") sanitizeAnchor(element, originalAttributes.get("href") ?? "");
  if (tag === "img") sanitizeImage(document, element, originalAttributes, allowRemoteImages, cidImages);
  if (["td", "th"].includes(tag)) {
    copyBoundedIntegerAttribute(element, "colspan", originalAttributes.get("colspan"), 20);
    copyBoundedIntegerAttribute(element, "rowspan", originalAttributes.get("rowspan"), 100);
  }
}

function sanitizeAnchor(element: Element, rawHref: string) {
  const href = safeHttpUrl(rawHref);
  if (!href) return;
  const hostname = new URL(href).hostname;
  if (hostname && !element.textContent?.toLocaleLowerCase().includes(hostname.toLocaleLowerCase())) {
    const host = element.ownerDocument.createElement("span");
    host.className = "mat-link-host";
    host.textContent = ` [${hostname}]`;
    element.append(host);
  }
  element.setAttribute("href", href);
  element.setAttribute("target", "_blank");
  element.setAttribute("rel", "noopener noreferrer");
}

function sanitizeImage(document: Document, element: Element, attributes: Map<string, string>, allowRemoteImages: boolean, cidImages: Record<string, string>) {
  const rawSource = attributes.get("src") ?? "";
  const alt = (attributes.get("alt") ?? "").slice(0, 500);
  const cid = /^cid:(.+)$/i.exec(rawSource)?.[1];
  const localSource = cid ? cidImages[normalizeCid(cid)] : null;
  const remoteSource = safeHttpUrl(rawSource);

  if (localSource && /^data:image\/(png|jpeg|gif|webp);base64,/i.test(localSource)) {
    element.setAttribute("src", localSource);
    if (alt) element.setAttribute("alt", alt);
    element.setAttribute("loading", "lazy");
    return;
  }
  if (allowRemoteImages && remoteSource) {
    element.setAttribute("src", remoteSource);
    element.setAttribute("alt", alt);
    element.setAttribute("loading", "lazy");
    element.setAttribute("referrerpolicy", "no-referrer");
    element.setAttribute("crossorigin", "anonymous");
    return;
  }

  const placeholder = document.createElement("span");
  placeholder.className = "mat-blocked-image";
  placeholder.textContent = remoteSource
    ? `[Remote image blocked${alt ? `: ${alt}` : ""}]`
    : `[Inline image unavailable${alt ? `: ${alt}` : ""}]`;
  element.replaceWith(placeholder);
}

function copyBoundedIntegerAttribute(element: Element, name: string, rawValue: string | undefined, maximum: number) {
  const value = Number.parseInt(rawValue ?? "", 10);
  if (Number.isInteger(value) && value > 0) element.setAttribute(name, String(Math.min(value, maximum)));
}

function safeHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

function trimUrlEnd(value: string) {
  let result = value;
  while (/[.,;:!?]$/.test(result)) result = result.slice(0, -1);
  for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"]] as const) {
    while (result.endsWith(close) && count(result, close) > count(result, open)) result = result.slice(0, -1);
  }
  return result;
}

function count(value: string, needle: string) {
  return value.split(needle).length - 1;
}

export function normalizeCid(value: string) {
  let decoded = value;
  try { decoded = decodeURIComponent(value); } catch { /* malformed percent encoding stays literal */ }
  return decoded.trim().replace(/^<|>$/g, "");
}
