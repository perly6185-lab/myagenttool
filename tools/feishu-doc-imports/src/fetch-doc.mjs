// Playwright-based renderer for a public Feishu wiki/docx document.
//
// Feishu docs are JS-rendered SPAs with virtualized content (only viewport
// blocks mount). The validated strategy, proven against the probe document
// (308 blocks, 13 sections, 15 images, no truncation, no duplication):
//
//   1. Page 1 of the block tree is embedded in the SSR HTML response inside a
//      `clientVars: Object({...})` literal. We extract it with a brace-balanced
//      scanner (JSON.parse of the matched object).
//   2. The remaining pages are fetched via the SPA's own content API from
//      inside the page context (`/space/api/docx/pages/client_vars`, guest
//      session, no credentials), paginating over `next_cursors` until
//      `has_more` is false. Blocks are merged into one map by id.
//   3. Images are captured from the browser's own image/* responses during a
//      top-to-bottom scroll pass — the browser has already handled CORS and any
//      decryption, so we receive final plaintext bytes. Where the request URL
//      exposes the file token we record it for precise block association;
//      otherwise the orchestrator falls back to positional matching.
//
// This module owns NO disk writes and NO security-sensitive state; it returns
// structured data for import-doc to persist.

import { chromium } from "playwright";

/** Content-API path the SPA uses to page block content. */
const CLIENT_VARS_PATH = "/space/api/docx/pages/client_vars";
/** Page size observed in the wild (server cap). */
const CLIENT_VARS_LIMIT = 239;

/** @typedef {{ bytes: Buffer, contentType: string, sourceUrl: string, token: string | null, sha: string }} CapturedImage */

/**
 * Render a public Feishu document and return its block tree + captured images.
 *
 * @param {{
 *   url: string,
 *   canonicalUrl: string,
 *   config: { limits: Record<string,number>, headless: boolean },
 *   signal?: AbortSignal,
 * }} ctx
 * @returns {Promise<{
 *   title: string,
 *   blockMap: Record<string, any>,
 *   blockSequence: string[],
 *   rootId: string | undefined,
 *   images: CapturedImage[],
 *   docId: string | null,
 *   blockCount: number,
 * }>}
 */
export async function renderFeishuDoc({ url, canonicalUrl, config, signal }) {
  const limits = config.limits;
  const browser = await chromium.launch({
    headless: config.headless,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    // Track the doc id the SPA uses for its own content calls (robust against
    // wiki-vs-docx token differences — we let the SPA tell us the canonical id).
    let capturedDocId = null;
    /** @type {CapturedImage[]} */
    const images = [];
    const seenSha = new Set();

    page.on("request", (req) => {
      const u = req.url();
      if (u.includes(CLIENT_VARS_PATH)) {
        const id = new URL(u, canonicalUrl).searchParams.get("id");
        if (id && !capturedDocId) capturedDocId = id;
      }
    });

    page.on("response", async (res) => {
      if (images.length >= limits.assetCount) return;
      const ct = (res.headers()["content-type"] || "").toLowerCase();
      if (!ct.startsWith("image/")) return;
      const u = res.url();
      // Only keep genuine document images: the drive-stream cover/download
      // endpoint (mount_point=docx_image) and in-page blob: URLs the browser
      // has already decrypted. This excludes UI sprites, favicons, avatars
      // (/static-resource/) and Feishu's own load-error placeholder.
      if (!isContentImage(u)) return;
      try {
        const buf = await res.body();
        if (!buf || buf.length < 2048) return;
        const total = images.reduce((n, i) => n + i.bytes.length, 0);
        if (total + buf.length > limits.assetTotalBytes) return;
        const { createHash } = await import("node:crypto");
        const sha = createHash("sha256").update(buf).digest("hex");
        if (seenSha.has(sha)) return;
        seenSha.add(sha);
        images.push({ bytes: buf, contentType: ct.split(";")[0].trim(), sourceUrl: u, token: extractToken(u), sha });
      } catch {
        /* response already disposed — ignore */
      }
    });

    const navResp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: limits.pageTimeoutMs });
    await page.waitForLoadState("networkidle", { timeout: limits.pageTimeoutMs }).catch(() => {});

    // --- Page 1 ---------------------------------------------------------------
    // Prefer the runtime-parsed window.DATA.clientVars (always present once the
    // SPA boots — confirmed by the probe). Fall back to scanning the raw SSR
    // navigation response body for the embedded `clientVars: Object({...})`
    // literal (page.content() is the hydrated live DOM and may omit it).
    let page1 = await page
      .evaluate(() => (window.DATA && window.DATA.clientVars && window.DATA.clientVars.data) || null)
      .catch(() => null);
    if (!page1 && navResp) {
      try {
        const raw = await navResp.text();
        page1 = (extractClientVars(raw) || {}).data || null;
      } catch {
        page1 = null;
      }
    }
    if (!page1) {
      throw new Error(
        "Could not find embedded document content (clientVars) in the page. The link may require login or be private.",
      );
    }
    /** @type {Record<string,any>} */
    const blockMap = { ...(page1.block_map || {}) };
    /** @type {string[]} */
    const blockSequence = [...(page1.block_sequence || [])];

    // --- Remaining pages: in-page content API over cursors ---------------------
    const docId = capturedDocId || page1.doc_id || page1.document_id || null;
    if (docId) {
      let hasMore = page1.has_more === true;
      let cursors = Array.isArray(page1.next_cursors) ? page1.next_cursors : [];
      let guard = 0;
      while (hasMore && cursors.length && guard < limits.blockMax) {
        guard++;
        const result = await page
          .evaluate(
            async ([apiUrl]) => {
              const r = await fetch(apiUrl, { credentials: "include" });
              return { status: r.status, json: r.ok ? await r.json() : null };
            },
            [
              `${CLIENT_VARS_PATH}?id=${encodeURIComponent(docId)}&mode=7&limit=${CLIENT_VARS_LIMIT}&cursor=${encodeURIComponent(cursors[0])}`,
            ],
          )
          .catch(() => null);
        const data = result && result.json && result.json.data;
        if (!data) break;
        Object.assign(blockMap, data.block_map || {});
        blockSequence.push(...(data.block_sequence || []));
        hasMore = data.has_more === true;
        cursors = Array.isArray(data.next_cursors) ? data.next_cursors : [];
      }
    }

    // --- Scroll pass to trigger image loads ------------------------------------
    await scrollToBottom(page, limits);

    const rootId = findRootId(blockMap, blockSequence);
    const title = await extractTitle(page, blockMap, blockSequence, rootId);

    if (signal && signal.aborted) throw new Error("Aborted");
    return {
      title,
      blockMap,
      blockSequence,
      rootId,
      images,
      docId,
      blockCount: blockSequence.length,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Scroll the page to the bottom in steps, capturing lazy-loaded images. Stops
 * early once the document height stabilizes for several consecutive steps.
 *
 * @param {import("playwright").Page} page
 * @param {Record<string, number>} limits
 */
async function scrollToBottom(page, limits) {
  let prevHeight = 0;
  let stable = 0;
  for (let i = 0; i < limits.scrollMaxSteps; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await page.waitForTimeout(limits.scrollSettleMs).catch(() => {});
    const h = await page.evaluate(() => document.body.scrollHeight).catch(() => prevHeight);
    if (h === prevHeight) {
      stable++;
      if (stable >= 3) break;
    } else {
      stable = 0;
    }
    prevHeight = h;
  }
  // Final settle so trailing image responses flush.
  await page.waitForTimeout(500).catch(() => {});
}

/**
 * Extract the page-1 clientVars object from SSR HTML. The object lives inside a
 * `clientVars: Object({...})` literal inside an inline `<script>`. A naive
 * regex fails on nested braces, so we scan for the opening brace after the
 * marker and balance braces (string-aware) to find the close.
 *
 * @param {string} html
 * @returns {any | null}
 */
export function extractClientVars(html) {
  const marker = "clientVars: Object(";
  const at = html.indexOf(marker);
  if (at < 0) return null;
  let i = at + marker.length;
  while (i < html.length && html[i] !== "{") i++;
  const start = i;
  let depth = 0;
  let inStr = false;
  let q = "";
  let esc = false;
  for (; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === q) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = true;
      q = c;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Best-effort extraction of a file token from a Feishu image request URL.
 *
 * @param {string} u
 * @returns {string | null}
 */
function extractToken(u) {
  const patterns = [
    /\/drive\/media\/([A-Za-z0-9_-]{16,})/,
    /[?&]file_token=([A-Za-z0-9_-]{16,})/,
    /\/file\/([A-Za-z0-9_-]{20,})/,
    /\/stream\/download\/(?:v\d+\/)?(?:cover|download)\/([A-Za-z0-9_-]{16,})/,
  ];
  for (const re of patterns) {
    const m = u.match(re);
    if (m) return m[1];
  }
  return null;
}

/**
 * Decide whether an image response URL is a genuine document content image
 * (vs. UI decoration, avatars, sprites, or Feishu's load-error placeholder).
 *
 * @param {string} u
 * @returns {boolean}
 */
function isContentImage(u) {
  if (u.startsWith("blob:")) return true;
  if (/\/space\/api\/box\/stream\/download\//.test(u)) return true;
  if (/\/drive\/media\//.test(u)) return true;
  return false;
}

/**
 * @param {Record<string,any>} blockMap
 * @param {string[]} sequence
 * @returns {string | undefined}
 */
function findRootId(blockMap, sequence) {
  for (const id of sequence) {
    if (blockMap[id]?.data?.type === "page") return id;
  }
  for (const id of Object.keys(blockMap)) {
    if (blockMap[id]?.data?.type === "page") return id;
  }
  return sequence[0];
}

/**
 * @param {import("playwright").Page} page
 * @param {Record<string,any>} blockMap
 * @param {string[]} sequence
 * @param {string | undefined} rootId
 * @returns {Promise<string>}
 */
async function extractTitle(page, blockMap, sequence, rootId) {
  let title = "";
  try {
    title = await page.title();
  } catch {
    title = "";
  }
  title = title.replace(/\s*[-–—]\s*飞书云文档\s*$/u, "").replace(/\s*[-–—]\s*Lark\s*$/u, "").trim();
  if (title) return title;
  // Fallback: first heading block under the root.
  if (rootId) {
    const rootChildren = blockMap[rootId]?.data?.children || [];
    for (const id of rootChildren.length ? rootChildren : sequence) {
      const t = blockMap[id]?.data?.type;
      if (typeof t === "string" && t.startsWith("heading")) {
        const seg = blockMap[id]?.data?.text?.initialAttributedTexts?.text;
        if (seg) {
          return Object.keys(seg)
            .sort((a, b) => Number(a) - Number(b))
            .map((k) => seg[k])
            .join("");
        }
      }
    }
  }
  return "untitled";
}
