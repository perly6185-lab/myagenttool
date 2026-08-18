// Orchestrator: turn a public Feishu URL into an on-disk markdown bundle.
//
// Pipeline: parse URL → render (Playwright) → convert blocks to markdown →
// resolve captured images to relative asset paths → atomically write a bundle.
//
// Output layout (aligned with apps/server article-imports so Phase 2 can land
// smoothly):
//   <outDir>/<YYYY-MM-DD>-<slug>-<hash8>/
//     doc.md          YAML front-matter (source_provider=feishu, source_url,
//                     canonical_url, title, fetched_at, url_hash, block_count)
//     manifest.json   schemaVersion 2 provenance + file index
//     assets/         downloaded images (NN.<ext>)
//
// Disk-write discipline mirrors importArticleToWorktree: stage into a hidden
// temp dir, assert every path stays confined under the outDir, then a single
// atomic rename into place. Nothing is written to the final path until the
// bundle is complete.

import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { blocksToMarkdown } from "./blocks-to-markdown.mjs";
import { resolveConfig } from "./config.mjs";
import { renderFeishuDoc } from "./fetch-doc.mjs";
import { parseFeishuUrl } from "./parse-url.mjs";

const ASSET_PROTOCOL = "feishu-asset://";
const SCHEMA_VERSION = 2;
const SLUG_MAX = 60;

/**
 * Import a public Feishu document to a local markdown bundle.
 *
 * @param {{
 *   url: string,
 *   outDir?: string,
 *   config?: ReturnType<typeof resolveConfig>,
 *   signal?: AbortSignal,
 *   fetchedAt?: Date,
 * }} args
 * @returns {Promise<{
 *   dir: string,
 *   markdownPath: string,
 *   manifestPath: string,
 *   assetCount: number,
 *   blockCount: number,
 *   title: string,
 *   canonicalUrl: string,
 * }>}
 */
export async function importFeishuDoc({ url, outDir, config, signal, fetchedAt }) {
  const cfg = config || resolveConfig();
  const out = outDir || cfg.outDir;
  const parsed = await parseFeishuUrl(url);
  const when = fetchedAt || new Date();

  const rendered = await renderFeishuDoc({
    url,
    canonicalUrl: parsed.canonicalUrl,
    config: cfg,
    signal,
  });

  const { markdown: bodyMd, images: docImages } = blocksToMarkdown({
    blockMap: rendered.blockMap,
    blockSequence: rendered.blockSequence,
    rootId: rendered.rootId,
  });

  const slug = slugify(rendered.title) || `feishu-${parsed.urlHash}`;
  const dateStamp = formatDateStamp(when);
  const bundleName = `${dateStamp}-${slug}-${parsed.urlHash}`;
  const finalDir = path.resolve(out, bundleName);
  const stagingDir = path.resolve(out, `.${bundleName}.tmp-${randomBytes(4).toString("hex")}`);

  await fs.mkdir(path.join(stagingDir, "assets"), { recursive: true });

  // --- Resolve images: map captured bytes to converter image slots ----------
  const { rewrittenMarkdown, files, notCaptured } = resolveImages(bodyMd, docImages, rendered.images);

  // --- Write assets ----------------------------------------------------------
  for (const f of files) {
    const dest = path.join(stagingDir, "assets", f.name);
    assertConfined(stagingDir, dest);
    await fs.writeFile(dest, f.bytes, { flag: "wx" });
  }

  // --- doc.md with YAML front-matter ----------------------------------------
  const frontMatter = renderFrontMatter({
    sourceUrl: url,
    canonicalUrl: parsed.canonicalUrl,
    title: rendered.title,
    when,
    urlHash: parsed.urlHash,
    blockCount: rendered.blockCount,
  });
  const docPath = path.join(stagingDir, "doc.md");
  assertConfined(stagingDir, docPath);
  await fs.writeFile(docPath, frontMatter + rewrittenMarkdown, { encoding: "utf8" });

  // --- manifest.json ---------------------------------------------------------
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    source_provider: "feishu",
    source_url: url,
    canonical_url: parsed.canonicalUrl,
    url_hash: parsed.urlHash,
    title: rendered.title,
    doc_id: rendered.docId,
    fetched_at: when.toISOString(),
    block_count: rendered.blockCount,
    asset_count: files.length,
    asset_total_bytes: files.reduce((n, f) => n + f.bytes.length, 0),
    image_slots: docImages.length,
    images_not_captured: notCaptured,
    notes:
      notCaptured.length > 0
        ? [`${notCaptured.length} image slot(s) could not be resolved from captured responses; see feishu-asset placeholders in doc.md.`]
        : [],
    files: files.map((f) => ({
      path: `assets/${f.name}`,
      sha256: f.sha,
      bytes: f.bytes.length,
      content_type: f.contentType,
      token: f.token,
      source_url: f.sourceUrl,
    })),
  };
  const manifestPath = path.join(stagingDir, "manifest.json");
  assertConfined(stagingDir, manifestPath);
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), { encoding: "utf8" });

  // --- Atomic publish --------------------------------------------------------
  try {
    await fs.rename(stagingDir, finalDir);
  } catch (err) {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    if (err && err.code === "ENOTEMPTY") {
      throw new Error(`Bundle already exists: ${finalDir}`);
    }
    throw err;
  }

  return {
    dir: finalDir,
    markdownPath: path.join(finalDir, "doc.md"),
    manifestPath: path.join(finalDir, "manifest.json"),
    assetCount: files.length,
    blockCount: rendered.blockCount,
    title: rendered.title,
    canonicalUrl: parsed.canonicalUrl,
  };
}

/**
 * Map captured image responses onto the converter's image slots (tree order),
 * and rewrite the markdown placeholders to relative asset paths.
 *
 * Association: if a captured response carried the same token as the slot, use
 * it (precise). Otherwise fall back to positional matching against the
 * remaining token-less captures in scroll order. Unresolved slots become
 * explanatory HTML comments.
 *
 * @param {string} markdown
 * @param {{ token: string, blockId: string }[]} docImages
 * @param {CapturedImageLike[]} captures
 * @returns {{ rewrittenMarkdown: string, files: AssetFile[], notCaptured: string[] }}
 *
 * @typedef {{ bytes: Buffer, contentType: string, sourceUrl: string, token: string | null, sha: string }} CapturedImageLike
 * @typedef {{ name: string, bytes: Buffer, contentType: string, sourceUrl: string, token: string | null, sha: string }} AssetFile
 */
export function resolveImages(markdown, docImages, captures) {
  /** @type {Map<string, number>} token -> capture index (first wins) */
  const byToken = new Map();
  captures.forEach((c, i) => {
    if (c.token && !byToken.has(c.token)) byToken.set(c.token, i);
  });
  /** positional pool: capture indices with no usable token, in scroll order */
  const positional = captures.map((_, i) => i).filter((i) => !captures[i].token);

  // Assign each converter slot (tree order) to one capture. A token match wins
  // and is shared (two slots with the same token map to one file); otherwise the
  // slot consumes the next unused token-less capture. -1 means unresolved.
  const posUsed = new Set();
  /** @type {number[]} */
  const slotAssignment = docImages.map((slot) => {
    if (byToken.has(slot.token)) return byToken.get(slot.token);
    const next = positional.find((p) => !posUsed.has(p));
    if (next === undefined) return -1;
    posUsed.add(next);
    return next;
  });

  // Number files by first use of each distinct capture.
  /** @type {Map<number, string>} */
  const captureToName = new Map();
  /** @type {AssetFile[]} */
  const files = [];
  let seq = 0;
  for (const capIdx of slotAssignment) {
    if (capIdx < 0 || captureToName.has(capIdx)) continue;
    const cap = captures[capIdx];
    const name = `${String(seq + 1).padStart(2, "0")}${extFromContentType(cap.contentType)}`;
    captureToName.set(capIdx, name);
    files.push({
      name,
      bytes: cap.bytes,
      contentType: cap.contentType,
      sourceUrl: cap.sourceUrl,
      token: cap.token,
      sha: cap.sha,
    });
    seq++;
  }

  /** @type {string[]} */
  const notCaptured = [];
  slotAssignment.forEach((capIdx, i) => {
    if (capIdx < 0) notCaptured.push(docImages[i].token);
  });

  // Rewrite placeholders by occurrence. The converter emits exactly one
  // feishu-asset:// placeholder per image block in tree order, which matches
  // docImages order — so occurrence N maps to slotAssignment[N].
  let occ = 0;
  const rewrittenMarkdown = markdown.replace(/!\[[^\]]*\]\(feishu-asset:\/\/[^)]+\)/g, () => {
    const capIdx = slotAssignment[occ++];
    if (capIdx === undefined || capIdx < 0) {
      return `<!-- image not captured -->`;
    }
    return `![](assets/${captureToName.get(capIdx)})`;
  });

  return { rewrittenMarkdown, files, notCaptured };
}

/**
 * @param {string} contentType
 * @returns {string}
 */
function extFromContentType(contentType) {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("png")) return ".png";
  if (ct.includes("jpeg") || ct.includes("jpg")) return ".jpg";
  if (ct.includes("webp")) return ".webp";
  if (ct.includes("gif")) return ".gif";
  if (ct.includes("bmp")) return ".bmp";
  if (ct.includes("svg")) return ".svg";
  return ".bin";
}

/**
 * @param {Date} d
 * @returns {string}
 */
export function formatDateStamp(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Slugify a title for use in a directory name. Keeps CJK and alphanumeric
 * (CJK titles are valid filenames on modern OSes), collapses whitespace and
 * punctuation to single hyphens, lowercases Latin. Empty result possible for
 * titles with no usable glyphs.
 *
 * @param {string} title
 * @returns {string}
 */
export function slugify(title) {
  const cleaned = (title || "")
    .trim()
    .toLowerCase()
    // Replace runs of whitespace/punctuation (except CJK, letters, digits) with single '-'
    .replace(/[\s/\\:*?"<>|.,;!?'"‘’“”(){}\[\]]+/gu, "-")
    // Drop any other non-word, non-CJK characters
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned.slice(0, SLUG_MAX);
}

/**
 * @param {{
 *   sourceUrl: string,
 *   canonicalUrl: string,
 *   title: string,
 *   when: Date,
 *   urlHash: string,
 *   blockCount: number,
 * }} p
 * @returns {string}
 */
export function renderFrontMatter({ sourceUrl, canonicalUrl, title, when, urlHash, blockCount }) {
  const safeTitle = yamlScalar(title);
  const lines = [
    "---",
    `source_provider: feishu`,
    `source_url: ${yamlScalar(sourceUrl)}`,
    `canonical_url: ${yamlScalar(canonicalUrl)}`,
    `title: ${safeTitle}`,
    `fetched_at: ${when.toISOString()}`,
    `url_hash: ${urlHash}`,
    `block_count: ${blockCount}`,
    "---",
  ];
  // Trailing blank line separates the YAML fence from the body that follows.
  return lines.join("\n") + "\n\n";
}

/**
 * Quote a YAML scalar if it contains characters that would break parsing.
 * Titles and URLs frequently contain `:`, so we default to double-quoting.
 *
 * @param {string} s
 * @returns {string}
 */
export function yamlScalar(s) {
  const str = String(s ?? "");
  const needsQuote = /[:#\-?{}\[\],&*!|>'"%@`]/.test(str) || str === "" || /\s/.test(str);
  if (!needsQuote) return str;
  return `"${str.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Reject any target that escapes `root` via `..` or absolute paths. Mirrors
 * article-imports assertConfined.
 *
 * @param {string} root
 * @param {string} target
 * @returns {void}
 */
export function assertConfined(root, target) {
  const r = path.resolve(root);
  const t = path.resolve(target);
  const rel = path.relative(r, t);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path escapes outDir: ${target} (root=${root})`);
  }
}
