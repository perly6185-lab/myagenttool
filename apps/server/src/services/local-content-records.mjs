import { createHash } from "node:crypto";
import { basename, extname } from "node:path";

import { LOCAL_TEAM_ID } from "../runtime/auth.mjs";
import { searchTerms } from "./local-content-catalog-query.mjs";

const MAX_SEARCH_TEXT = 300_000;

export function catalogRecord(input) {
  const title = boundedText(input.title, 500) || "Untitled local content";
  const body = boundedText(input.body, MAX_SEARCH_TEXT);
  const summary = boundedText(input.summary, 1_000) || boundedSummary(body, title);
  return {
    id: input.id,
    ownerTeamId: input.ownerTeamId ?? LOCAL_TEAM_ID,
    projectId: input.projectId ?? null,
    workItemId: input.workItemId ?? null,
    kind: input.kind,
    title,
    summary,
    searchText: boundedText([
      title,
      summary,
      body,
      input.sourceId,
      metadataSearchText(input.metadata),
    ].filter(Boolean).join("\n"), MAX_SEARCH_TEXT),
    searchBody: body,
    storageMode: input.storageMode,
    rootKind: input.rootKind ?? null,
    rootId: input.rootId ?? null,
    relativePath: input.relativePath ?? null,
    stateCollection: input.stateCollection ?? null,
    stateId: input.stateId ?? null,
    mimeType: input.mimeType ?? null,
    size: Number.isSafeInteger(input.size) ? input.size : null,
    sha256: input.sha256 ?? null,
    sourceType: input.sourceType ?? null,
    sourceId: boundedText(input.sourceId, 2_000) || null,
    occurredAt: validTimestamp(input.occurredAt),
    importedAt: validTimestamp(input.importedAt),
    modifiedAt: validTimestamp(input.modifiedAt),
    originalAvailable: input.originalAvailable === true,
    unavailableReason: input.unavailableReason ?? null,
    indexStatus: input.indexStatus,
    metadata: input.metadata ?? {},
    indexedAt: input.indexedAt,
  };
}

export function friendlySourceLabel(row, metadata) {
  if (metadata.taskTitle) return metadata.projectName ? `${metadata.projectName} · ${metadata.taskTitle}` : metadata.taskTitle;
  if (row.kind === "mail") return metadata.accountLabel || metadata.from || "Mail";
  if (row.relative_path) return basename(String(row.relative_path));
  if (metadata.localRef) return metadata.localRef;
  return row.source_type || row.kind;
}

export function matchedSnippet(value, query) {
  const text = plainText(value);
  if (!text) return null;
  const terms = searchTerms(query);
  const lower = text.toLocaleLowerCase();
  const positions = terms.map((term) => lower.indexOf(term.toLocaleLowerCase())).filter((position) => position >= 0);
  const matchAt = positions.length ? Math.min(...positions) : 0;
  const start = Math.max(0, matchAt - 90);
  const end = Math.min(text.length, start + 320);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

export function validMailArchiveReceipt(value) {
  return value?.version === 1
    && value.availability === "available"
    && /^mailarc_[a-f0-9]{24}_[a-f0-9]{40}$/.test(String(value.ref ?? ""))
    && /^[a-f0-9]{64}$/.test(String(value.sha256 ?? ""))
    && Number.isSafeInteger(value.size)
    && value.size > 0
    && value.size <= 50 * 1024 * 1024;
}

export function contentId(kind, ...identity) {
  return `lc_${createHash("sha256").update(JSON.stringify([kind, ...identity])).digest("hex").slice(0, 32)}`;
}

export function dedupeRelations(relations) {
  return [...new Map(relations.map((relation) => [relation.id, relation])).values()];
}

export function rootPathKey(root, path) {
  return root?.kind && root?.id && path ? `${root.kind}:${root.id}:${safeRelativePath(path)}` : null;
}

export function safeRelativePath(value) {
  const normalized = String(value ?? "").replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || /^[a-z]:\//i.test(normalized)) return null;
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.includes("\0"))) return null;
  return parts.join("/").slice(0, 2_000);
}

export function storageKey(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex").slice(0, 24);
}

export function articleTitle(text) {
  const frontMatter = /^---\s*\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
  const yamlTitle = /^title:\s*["']?(.+?)["']?\s*$/im.exec(frontMatter)?.[1];
  const flattenedTitle = /(?:^|\s)title:\s*["']([^"']+)["']/.exec(text)?.[1];
  return boundedText(yamlTitle || flattenedTitle || /^#\s+(.+)$/m.exec(text)?.[1], 500);
}

export function boundedSummary(value, fallback) {
  const text = plainText(value).replace(/^---[\s\S]*?---\s*/, "").trim();
  return boundedText(text || fallback, 600);
}

export function plainText(value) {
  return String(value ?? "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<img\b([^>]*)>/gi, (_match, attributes) => {
      const source = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1] ?? "";
      const alt = /\balt\s*=\s*["']([^"']*)["']/i.exec(attributes)?.[1] ?? "image";
      return source ? ` [Image: ${alt}] (${source}) ` : ` [Image: ${alt}] `;
    })
    .replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_match, attributes, label) => {
      const target = /\bhref\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1] ?? "";
      return target ? ` ${label} (${target}) ` : ` ${label} `;
    })
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[([^\]]*)\]\(([^)]*)\)/g, " [Image: $1] ($2) ")
    .replace(/\[([^\]]+)\]\(([^)]*)\)/g, "$1 ($2)")
    .replace(/[`*_>#|~-]+/g, " ")
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function boundedText(value, limit) {
  return String(value ?? "").slice(0, limit);
}

export function validTimestamp(value) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

export function textExtension(path) {
  return new Set([".md", ".markdown", ".txt", ".html", ".htm", ".json", ".csv", ".tsv", ".xml", ".yaml", ".yml"])
    .has(extname(path).toLowerCase());
}

export function mimeTypeFor(path) {
  const extension = extname(path).toLowerCase();
  if (extension === ".pdf") return "application/pdf";
  if (extension === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (extension === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (extension === ".pptx") return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if ([".md", ".markdown"].includes(extension)) return "text/markdown";
  if ([".html", ".htm"].includes(extension)) return "text/html";
  if (extension === ".json") return "application/json";
  if (extension === ".csv") return "text/csv";
  if ([".txt", ".log", ".yaml", ".yml", ".xml", ".tsv"].includes(extension)) return "text/plain";
  return null;
}

export function normalizeDigest(value) {
  const text = String(value ?? "").toLowerCase();
  if (/^sha256:[a-f0-9]{64}$/.test(text)) return text;
  if (/^[a-f0-9]{64}$/.test(text)) return `sha256:${text}`;
  return null;
}

export function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function metadataSearchText(value, depth = 0) {
  if (depth > 2 || value == null) return "";
  if (["string", "number", "boolean"].includes(typeof value)) return boundedText(value, 2_000);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => metadataSearchText(item, depth + 1)).join(" ");
  if (typeof value === "object") {
    return Object.entries(value).slice(0, 50).flatMap(([key, item]) => [key, metadataSearchText(item, depth + 1)]).join(" ");
  }
  return "";
}
