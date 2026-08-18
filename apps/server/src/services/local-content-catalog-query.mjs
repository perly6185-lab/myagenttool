import { createHash } from "node:crypto";

export const LOCAL_CONTENT_KINDS = new Set(["article", "mail", "task", "task_input", "task_output"]);
export const LOCAL_CONTENT_INDEX_SOURCES = new Set(["articles", "mail", "work_items"]);

const MAX_SEARCH_QUERY = 500;
export const MAX_SEARCH_OFFSET = 1_000_000;
const SOURCE_KINDS = Object.freeze({
  articles: ["article"],
  mail: ["mail"],
  work_items: ["task", "task_input", "task_output"],
});

export function normalizeIndexSources(input) {
  const values = Array.isArray(input) ? input : [input];
  const normalized = values
    .flatMap((value) => String(value ?? "").split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (normalized.includes("all") || !normalized.length) return [...LOCAL_CONTENT_INDEX_SOURCES];
  const selected = [...new Set(normalized.filter((value) => LOCAL_CONTENT_INDEX_SOURCES.has(value)))];
  return selected.length ? selected.sort() : [...LOCAL_CONTENT_INDEX_SOURCES];
}

export function parseIndexSources(value) {
  try {
    return normalizeIndexSources(JSON.parse(String(value ?? "[]")));
  } catch {
    return [...LOCAL_CONTENT_INDEX_SOURCES];
  }
}

export function indexKindsForSources(sources) {
  return [...new Set(normalizeIndexSources(sources).flatMap((source) => SOURCE_KINDS[source] ?? []))];
}

export function normalizeKinds(input) {
  const values = Array.isArray(input) ? input : String(input ?? "").split(",");
  const kinds = [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
  return kinds.every((kind) => LOCAL_CONTENT_KINDS.has(kind))
    ? { ok: true, value: kinds }
    : { ok: false, value: [] };
}

export function normalizeChoice(value, allowed) {
  if (value == null || value === "") return { ok: true, value: null };
  const normalized = String(value).trim().toLowerCase();
  return allowed.includes(normalized)
    ? { ok: true, value: normalized }
    : { ok: false, value: null };
}

export function searchCursorBinding(value) {
  return createHash("sha256").update(JSON.stringify(value ?? {})).digest("base64url").slice(0, 32);
}

export function encodeSearchCursor(offset, binding) {
  return Buffer.from(JSON.stringify({ version: 2, offset, binding }), "utf8").toString("base64url");
}

export function decodeSearchCursor(value, expectedBinding) {
  if (value == null || value === "") return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    return parsed?.version === 2
      && typeof parsed.binding === "string"
      && parsed.binding === expectedBinding
      && Number.isSafeInteger(parsed.offset) && parsed.offset >= 0 && parsed.offset <= MAX_SEARCH_OFFSET
      ? parsed.offset
      : null;
  } catch {
    return null;
  }
}

export function sourceForKind(kind) {
  if (kind === "article") return "articles";
  if (kind === "mail") return "mail";
  return "work_items";
}

export function normalizeQuery(value) {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, MAX_SEARCH_QUERY);
}

export function ftsQuery(value) {
  const tokens = searchTerms(value);
  return tokens.map((token) => `"${token.replaceAll('"', '""')}"*`).join(" AND ");
}

export function searchTerms(value) {
  return value.match(/[\p{L}\p{N}_-]+/gu)?.slice(0, 20) ?? [];
}
