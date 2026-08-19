// Pure URL validation + canonicalization for a Xiaohongshu (小红书) URL.
//
// Xiaohongshu note URLs come in two families:
//   - direct note links: https://www.xiaohongshu.com/explore/<id>
//                        https://www.xiaohongshu.com/discovery/item/<id>?xsec_token=…
//   - App share short links: http(s)://xhslink.com/a/<slug>  (also /o/, /m/)
//     — the App's copy-link shares DEFAULT TO http://, and the server-side
//     article importer refuses http:// URLs (canonicalizeArticleUrl). The
//     browser follows the short link to the canonical note URL naturally, so
//     here we only need to accept and UPGRADE http → https (live matrix P0,
//     issue #1703: the http form is what real users paste).
//
// Share query parameters carry xsec_token — REQUIRED by many modern notes
// (the token rides the share link and the note page validates it). It is NOT
// a tracking parameter and MUST survive: nothing after ? is dropped here.
//
// This module owns NO I/O. It only decides whether a string is a public,
// browser-reachable Xiaohongshu URL (http/https, a xiaohongshu.com/xhslink.com
// host, no embedded credentials) and normalizes it. The login wall / risk
// control is handled by the Playwright engine in fetch-doc.mjs.
//
// Mirrors tools/qichacha-imports/src/parse-url.mjs with xiaohongshu's host
// family + the http upgrade.

const HOST_RE = /(?:^|\.)(?:xiaohongshu\.com|xhslink\.com)$/i;

export class XiaohongshuUrlError extends Error {
  constructor(message) {
    super(message);
    this.name = "XiaohongshuUrlError";
  }
}

/**
 * Validate and canonicalize a raw Xiaohongshu URL.
 *
 * @param {string} raw
 * @returns {{ canonicalUrl: string }}
 * @throws {XiaohongshuUrlError} when the URL is not a public Xiaohongshu URL.
 */
export function parseXiaohongshuUrl(raw) {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new XiaohongshuUrlError("URL is required.");
  }
  const trimmed = raw.trim();
  let u;
  try {
    u = new URL(trimmed);
  } catch {
    throw new XiaohongshuUrlError(`Not a valid URL: ${trimmed}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new XiaohongshuUrlError(`Only http/https URLs are allowed: ${trimmed}`);
  }
  // Reject embedded credentials (http://user:pass@...). These never appear on a
  // genuine public Xiaohongshu link and would be a credential-injection smell.
  if (u.username !== "" || u.password !== "") {
    throw new XiaohongshuUrlError("Embedded credentials are not allowed in Xiaohongshu URLs.");
  }
  const host = u.hostname.toLowerCase();
  if (!HOST_RE.test(host)) {
    throw new XiaohongshuUrlError(`Not a xiaohongshu.com/xhslink.com URL: ${host}`);
  }
  // App share short links are http:// by default; the site serves https.
  // Upgrade BEFORE the host check's consumers so the render always speaks https.
  u.protocol = "https:";
  // Drop the hash (tracking fragments only). Keep pathname + search — the
  // search carries xsec_token, which note pages validate (see header comment).
  u.hash = "";
  const canonicalUrl = u.href;
  return { canonicalUrl };
}
