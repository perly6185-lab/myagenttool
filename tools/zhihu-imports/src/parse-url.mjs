// Pure URL validation + canonicalization for a public Zhihu article URL.
//
// Zhihu content pages live under a few stable host shapes:
//   - https://zhuanlan.zhihu.com/p/<id>        (column / 专栏 article)
//   - https://www.zhihu.com/question/<id>...    (Q&A page; answer deep-links
//                                                may carry a trailing
//                                                /answer/<id> or ? query)
//
// This module owns NO I/O. It only decides whether a string is a public,
// browser-reachable Zhihu URL (http/https, a zhihu.com host, no embedded
// credentials) and normalizes it. The actual secng / zse-ck JS challenge is
// handled by the Playwright engine in fetch-doc.mjs.
//
// Mirrors tools/feishu-doc-imports/src/parse-url.mjs, but zhihu URLs carry no
// kind/token distinction, so this returns a single canonical URL.

const HOST_RE = /(?:^|\.)zhihu\.com$/i;

export class ZhihuUrlError extends Error {
  constructor(message) {
    super(message);
    this.name = "ZhihuUrlError";
  }
}

/**
 * Validate and canonicalize a raw Zhihu URL.
 *
 * @param {string} raw
 * @returns {{ canonicalUrl: string }}
 * @throws {ZhihuUrlError} when the URL is not a public Zhihu article URL.
 */
export function parseZhihuUrl(raw) {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new ZhihuUrlError("URL is required.");
  }
  const trimmed = raw.trim();
  let u;
  try {
    u = new URL(trimmed);
  } catch {
    throw new ZhihuUrlError(`Not a valid URL: ${trimmed}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new ZhihuUrlError(`Only http/https URLs are allowed: ${trimmed}`);
  }
  // Reject embedded credentials (http://user:pass@...). These never appear on a
  // genuine public Zhihu link and would be a credential-injection smell.
  if (u.username !== "" || u.password !== "") {
    throw new ZhihuUrlError("Embedded credentials are not allowed in Zhihu URLs.");
  }
  const host = u.hostname.toLowerCase();
  if (!HOST_RE.test(host)) {
    throw new ZhihuUrlError(`Not a zhihu.com URL: ${host}`);
  }
  // Drop the hash (tracking fragments only). Keep pathname + search so
  // question-answer deep-links (which can depend on a query param) keep routing.
  u.hash = "";
  const canonicalUrl = u.href;
  return { canonicalUrl };
}
