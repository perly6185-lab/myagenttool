// Pure URL validation + canonicalization for a Jianshu (简书) URL.
//
// Jianshu article URLs are a single family:
//   https://www.jianshu.com/p/<slug>   (canonical article path)
// with www being the common host (bare jianshu.com redirects there). No
// short-link domain is known; if one appears, extend HOST_RE.
//
// http:// forms appear in older shares and are upgraded to https (the site
// serves both; the upgrade keeps the render protocol uniform — same rationale
// as the xiaohongshu app-share upgrade, issue #1703).
//
// This module owns NO I/O. It only decides whether a string is a public,
// browser-reachable Jianshu URL (http/https, a jianshu.com host, no embedded
// credentials) and normalizes it. The render itself lives in fetch-doc.mjs.
//
// Mirrors tools/xiaohongshu-imports/src/parse-url.mjs with jianshu's host
// family.

const HOST_RE = /(?:^|\.)jianshu\.com$/i;

export class JianshuUrlError extends Error {
  constructor(message) {
    super(message);
    this.name = "JianshuUrlError";
  }
}

/**
 * Validate and canonicalize a raw Jianshu URL.
 *
 * @param {string} raw
 * @returns {{ canonicalUrl: string }}
 * @throws {JianshuUrlError} when the URL is not a public Jianshu URL.
 */
export function parseJianshuUrl(raw) {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new JianshuUrlError("URL is required.");
  }
  const trimmed = raw.trim();
  let u;
  try {
    u = new URL(trimmed);
  } catch {
    throw new JianshuUrlError(`Not a valid URL: ${trimmed}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new JianshuUrlError(`Only http/https URLs are allowed: ${trimmed}`);
  }
  // Reject embedded credentials (http://user:pass@...). These never appear on a
  // genuine public Jianshu link and would be a credential-injection smell.
  if (u.username !== "" || u.password !== "") {
    throw new JianshuUrlError("Embedded credentials are not allowed in Jianshu URLs.");
  }
  const host = u.hostname.toLowerCase();
  if (!HOST_RE.test(host)) {
    throw new JianshuUrlError(`Not a jianshu.com URL: ${host}`);
  }
  // Older shares ride plain http; the site serves https. Upgrade so the render
  // always speaks https.
  u.protocol = "https:";
  // Drop the hash (tracking fragments only). Keep pathname + search.
  u.hash = "";
  const canonicalUrl = u.href;
  return { canonicalUrl };
}
