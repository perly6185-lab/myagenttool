// Pure URL validation + canonicalization for a Qichacha (企查查) page URL.
//
// Qichacha content pages live under two registrars' hosts:
//   - https://www.qcc.com/firm/<uuid>.shtml   (company detail page)
//   - https://www.qichacha.com/firm/<uuid>.shtml (mirror domain)
//   (m.qcc.com serves the mobile shell — accepted, tuned later if ever needed)
//
// This module owns NO I/O. It only decides whether a string is a public,
// browser-reachable Qichacha URL (http/https, a qcc.com/qichacha.com host, no
// embedded credentials) and normalizes it. The login wall + slider risk
// control is handled by the Playwright engine in fetch-doc.mjs.
//
// Mirrors tools/zhihu-imports/src/parse-url.mjs, with qichacha's two-host
// family; qichacha URLs carry no kind/token distinction, so this returns a
// single canonical URL.

const HOST_RE = /(?:^|\.)(?:qcc|qichacha)\.com$/i;

export class QichachaUrlError extends Error {
  constructor(message) {
    super(message);
    this.name = "QichachaUrlError";
  }
}

/**
 * Validate and canonicalize a raw Qichacha URL.
 *
 * @param {string} raw
 * @returns {{ canonicalUrl: string }}
 * @throws {QichachaUrlError} when the URL is not a public Qichacha page URL.
 */
export function parseQichachaUrl(raw) {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new QichachaUrlError("URL is required.");
  }
  const trimmed = raw.trim();
  let u;
  try {
    u = new URL(trimmed);
  } catch {
    throw new QichachaUrlError(`Not a valid URL: ${trimmed}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new QichachaUrlError(`Only http/https URLs are allowed: ${trimmed}`);
  }
  // Reject embedded credentials (http://user:pass@...). These never appear on a
  // genuine public Qichacha link and would be a credential-injection smell.
  if (u.username !== "" || u.password !== "") {
    throw new QichachaUrlError("Embedded credentials are not allowed in Qichacha URLs.");
  }
  const host = u.hostname.toLowerCase();
  if (!HOST_RE.test(host)) {
    throw new QichachaUrlError(`Not a qcc.com/qichacha.com URL: ${host}`);
  }
  // Drop the hash (tracking fragments only). Keep pathname + search so firm
  // deep-links keep routing.
  u.hash = "";
  const canonicalUrl = u.href;
  return { canonicalUrl };
}
