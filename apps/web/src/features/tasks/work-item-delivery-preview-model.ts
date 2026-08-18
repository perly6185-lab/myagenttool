import type { LocalWorkItem } from "./task-view-types";

const BROWSABLE_DELIVERY_EXTENSIONS = new Set([
  ".docx", ".xlsx", ".pptx", ".pdf", ".dxf", ".dwg",
  ".md", ".mdx", ".html", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg",
  ".mp3", ".m4a", ".ogg", ".wav", ".mp4", ".webm", ".mov", ".canvas", ".excalidraw",
]);
const OFFICE_DELIVERY_EXTENSIONS = new Set([".docx", ".xlsx", ".pptx"]);

export type DeliveryPreview =
  | { kind: "markdown"; text: string; truncated: boolean }
  | { kind: "text"; text: string; truncated: boolean }
  | { kind: "image"; source: string }
  | { kind: "pdf"; source: string }
  | { kind: "office"; html: string };

export type MarkdownDocument = {
  body: string;
  metadata: Record<string, string>;
};

export function normalizedDeliveryPath(path: string) {
  return path.trim().replaceAll("\\", "/");
}

export function deliveryFileName(path: string) {
  return normalizedDeliveryPath(path).split("/").filter(Boolean).at(-1) ?? path;
}

export function deliveryFileCanUseLegacyPath(path: string) {
  const normalized = normalizedDeliveryPath(path).replace(/^\.\//, "");
  return Boolean(normalized
    && !normalized.startsWith("/")
    && !/^[a-z]:\//i.test(normalized)
    && normalized !== ".."
    && !normalized.startsWith("../")
    && !normalized.includes("/../"));
}

export function browsableDeliveryPath(path: string) {
  const name = deliveryFileName(path).toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot >= 0 && BROWSABLE_DELIVERY_EXTENSIONS.has(name.slice(dot));
}

export function deliveryExtension(path: string) {
  const name = deliveryFileName(path).toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot) : "";
}

export function isOfficeMaterial(asset: NonNullable<LocalWorkItem["inputAssets"]>[number]) {
  return OFFICE_DELIVERY_EXTENSIONS.has(deliveryExtension(asset.originalName ?? asset.path));
}

export function isOfficeDeliveryPath(path: string) {
  return OFFICE_DELIVERY_EXTENSIONS.has(deliveryExtension(path));
}

export function parseMarkdownDocument(text: string): MarkdownDocument {
  const normalized = text.replaceAll("\r\n", "\n");
  const frontMatter = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!frontMatter) return { body: normalized, metadata: {} };
  const metadata: Record<string, string> = {};
  for (const line of frontMatter[1].split("\n")) {
    const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.*?)\s*$/);
    if (!match || !match[2]) continue;
    metadata[match[1]] = match[2].replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2");
  }
  let body = normalized.slice(frontMatter[0].length).trimStart();
  if (metadata.title && !/^#\s+/m.test(body)) body = `# ${metadata.title}\n\n${body}`;
  return { body, metadata };
}

export function resolveDeliveryAssetPath(markdownPath: string, reference: string) {
  if (!reference || /^(?:https?:|data:|blob:|#)/i.test(reference)) return null;
  const cleanReference = reference.replace(/^<|>$/g, "").split(/[?#]/, 1)[0].replaceAll("\\", "/");
  if (!cleanReference || cleanReference.startsWith("/") || /^[a-z]:\//i.test(cleanReference)) return null;
  const parts = normalizedDeliveryPath(markdownPath).split("/").filter(Boolean);
  parts.pop();
  for (const segment of cleanReference.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return parts.join("/");
}

export function markdownImageReferences(text: string) {
  const references = new Set<string>();
  for (const match of text.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^)]*)?\)/g)) {
    const reference = match[1]?.replace(/^<|>$/g, "");
    if (reference && !/^(?:https?:|data:|blob:|#)/i.test(reference)) references.add(reference);
  }
  return [...references].slice(0, 12);
}

export function markdownImageCount(text: string) {
  return [...text.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^)]*)?\)/g)].length;
}

export function imageMime(path: string) {
  const extension = deliveryExtension(path);
  if (extension === ".png") return "image/png";
  if (extension === ".gif") return "image/gif";
  if (extension === ".webp") return "image/webp";
  if (extension === ".avif") return "image/avif";
  return "image/jpeg";
}
