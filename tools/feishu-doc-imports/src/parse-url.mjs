// Parse a Feishu/Lark public document URL into a normalized descriptor.
//
// Pure module — no I/O, safe to unit-test without a browser.
//
// Recognized kinds:
//   wiki   — https://<tenant>.feishu.cn/wiki/<nodeToken>   (also /wiki/<token>/<title>)
//   docx   — https://<tenant>.feishu.cn/docx/<docToken>
//   sheet  — https://<tenant>.feishu.cn/sheets/<sheetToken>   (Phase 1: text only; sheets unsupported)
//   share  — https://<tenant>.feishu.cn/share/...            (Phase 1: unsupported, surfaces a clear error)
//
// Domains accepted: *.feishu.cn and *.larksuite.com (both backed by the same app).

const HOST_RE = /(?:^|\.)(feishu\.cn|larksuite\.com)$/i;

/**
 * @typedef {Object} ParsedFeishuUrl
 * @property {"wiki"|"docx"} kind
 * @property {string} token        — document/node token from the path
 * @property {string} origin       — `https://<host>`
 * @property {string} host
 * @property {string} canonicalUrl — normalized `https://<host>/<kind>/<token>`
 * @property {string} urlHash      — sha1(canonicalUrl) first 8 hex chars
 */

export class FeishuUrlError extends Error {
  constructor(message) {
    super(message);
    this.name = "FeishuUrlError";
  }
}

/**
 * Normalize a raw URL string into a ParsedFeishuUrl, or throw FeishuUrlError.
 *
 * @param {string} raw
 * @returns {ParsedFeishuUrl}
 */
export async function parseFeishuUrl(raw) {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new FeishuUrlError("URL must be a non-empty string.");
  }
  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new FeishuUrlError(`Not a valid URL: ${raw}`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new FeishuUrlError(`Unsupported protocol ${u.protocol}; expected http(s).`);
  }
  if (u.username || u.password) {
    throw new FeishuUrlError("URLs with embedded credentials are rejected.");
  }
  if (!HOST_RE.test(u.hostname)) {
    throw new FeishuUrlError(`Not a Feishu/Lark host: ${u.hostname}`);
  }

  const segments = u.pathname.split("/").filter(Boolean);
  if (segments.length === 0) {
    throw new FeishuUrlError(`No document path in URL: ${raw}`);
  }

  const [kindSeg, tokenSeg, ...rest] = segments;
  const kind = normalizeKind(kindSeg);
  if (!kind) {
    throw new FeishuUrlError(
      `Unsupported Feishu document type '/${kindSeg}/'. Phase 1 supports wiki and docx public links.`,
    );
  }
  if (!tokenSeg) {
    throw new FeishuUrlError(`Missing token in path: ${u.pathname}`);
  }
  // Tokens are opaque base62-ish identifiers; reject anything that looks like a
  // path traversal / extra path artifact.
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(tokenSeg)) {
    throw new FeishuUrlError(`Suspicious document token: ${tokenSeg}`);
  }
  void rest; // trailing title/query segments are ignored

  const origin = `https://${u.hostname}`;
  const canonicalUrl = `${origin}/${kind}/${tokenSeg}`;
  return {
    kind,
    token: tokenSeg,
    origin,
    host: u.hostname,
    canonicalUrl,
    urlHash: await sha1Hex8(canonicalUrl),
  };
}

/** @param {string} seg */
function normalizeKind(seg) {
  const s = seg.toLowerCase();
  if (s === "wiki") return "wiki";
  if (s === "docx") return "docx";
  if (s === "sheets" || s === "sheet") return null; // explicitly unsupported in Phase 1
  if (s === "share") return null;
  return null;
}

/**
 * First 8 hex chars of sha1. node:test runs sync, so this is sync via
 * createHash; the `await` in parseFeishuUrl keeps the door open for a future
 * WebCrypto port without an API break.
 *
 * @param {string} text
 * @returns {Promise<string>}
 */
async function sha1Hex8(text) {
  const { createHash } = await import("node:crypto");
  return createHash("sha1").update(text, "utf8").digest("hex").slice(0, 8);
}
