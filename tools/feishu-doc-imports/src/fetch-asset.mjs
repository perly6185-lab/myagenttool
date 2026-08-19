// Hardened HTTPS downloader for a single asset (image or small resource).
//
// Self-contained on purpose: this package must not reach across workspaces into
// apps/server. The shape mirrors apps/server/src/services/article-imports.mjs
// (fetchPinnedHttps / createPinnedLookup / fetchPublicResource):
//   - DNS pinning: resolve the host once, connect to that literal IP, and set
//     servername/Host so TLS still validates against the original hostname.
//   - Bounds: redirect count, per-response bytes, total timeout.
//   - https only; http and embedded credentials are rejected.
//   - Returns the raw Buffer + content-type, never writes to disk itself.

import crypto from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import https from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";

export class FetchAssetError extends Error {
  constructor(message) {
    super(message);
    this.name = "FetchAssetError";
  }
}

/**
 * Download a URL with DNS pinning and bounds. Redirects are followed up to
 * `limits.redirectMax`; each hop is re-pinned and re-validated.
 *
 * @param {string} rawUrl
 * @param {{
 *   limits?: { redirectMax?: number, requestTimeoutMs?: number, assetBytes?: number },
 *   signal?: AbortSignal,
 *   maxRedirects?: number,
 * }} [opts]
 * @returns {Promise<{ bytes: Buffer, contentType: string, url: string, bytes: number }>}
 */
export async function fetchAsset(rawUrl, opts = {}) {
  const limits = opts.limits || {};
  const maxRedirects = opts.maxRedirects ?? limits.redirectMax ?? 5;
  const timeoutMs = limits.requestTimeoutMs ?? 30_000;
  const maxBytes = limits.assetBytes ?? 25 * 1024 * 1024;
  let current = rawUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const { hostname, port, path, protocol } = parseHttpsUrl(current);
    const address = await resolvePinned(hostname);
    const buf = await downloadOnce({ address, hostname, port, path, timeoutMs, maxBytes, signal: opts.signal });
    // Detect redirects only via Location + 3xx (do not blindly follow HTML refreshes).
    if (buf.statusCode >= 300 && buf.statusCode < 400 && buf.headers.location) {
      current = new URL(buf.headers.location, current).toString();
      continue;
    }
    if (buf.statusCode < 200 || buf.statusCode >= 300) {
      throw new FetchAssetError(`HTTP ${buf.statusCode} for ${current}`);
    }
    return {
      bytes: buf.body,
      contentType: buf.contentType,
      url: current,
      bytes: buf.body.length,
    };
  }
  throw new FetchAssetError(`Too many redirects (> ${maxRedirects}) fetching ${rawUrl}`);
}

/** @param {string} raw */
function parseHttpsUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new FetchAssetError(`Invalid URL: ${raw}`);
  }
  if (u.protocol !== "https:") throw new FetchAssetError(`Refusing non-https URL: ${raw}`);
  if (u.username || u.password) throw new FetchAssetError(`Refusing URL with credentials: ${raw}`);
  return {
    hostname: u.hostname,
    port: u.port || "443",
    path: `${u.pathname}${u.search}`,
    protocol: u.protocol,
  };
}

/**
 * Resolve a hostname to a single pinned IPv4/IPv6 literal. Refuses to connect
 * by letting the TLS layer re-resolve, which would defeat pinning.
 *
 * @param {string} hostname
 * @returns {Promise<string>}
 */
async function resolvePinned(hostname) {
  if (isIP(hostname)) return hostname;
  try {
    const records = await dnsLookup(hostname, { all: true });
    if (records && records.length) {
      // Prefer IPv4 for predictability.
      const v4 = records.find((r) => r.family === 4);
      return (v4 || records[0]).address;
    }
  } catch {
    /* fall through */
  }
  throw new FetchAssetError(`DNS resolution failed for ${hostname}`);
}

/**
 * Single pinned GET. Collects the body up to maxBytes; aborts on overflow or
 * timeout. Returns the status line + body even for non-2xx so the caller can
 * decide on redirects.
 *
 * @param {{address:string,hostname:string,port:string,path:string,timeoutMs:number,maxBytes:number,signal?:AbortSignal}} p
 */
function downloadOnce({ address, hostname, port, path, timeoutMs, maxBytes, signal }) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const req = https.get(
      {
        host: address,
        port,
        path,
        method: "GET",
        servername: hostname,
        headers: {
          Host: hostname,
          "User-Agent": "myagenttool-feishu-doc-imports/0 (+https://github.com/perly6185-lab)",
          Accept: "*/*",
        },
        timeout: timeoutMs,
      },
      (res) => {
        const contentType = (res.headers["content-type"] || "").toString().split(";")[0].trim();
        const body = Readable.fromWeb(/** @type {any} */ (res)).on("data", (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            if (!settled) {
              settled = true;
              req.destroy();
              reject(new FetchAssetError(`Asset exceeds ${maxBytes} bytes: ${hostname}${path}`));
            }
            return;
          }
          chunks.push(chunk);
        });
        body.on("end", () => {
          if (settled) return;
          settled = true;
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers,
            contentType,
            body: Buffer.concat(chunks),
          });
        });
        body.on("error", (err) => {
          if (!settled) {
            settled = true;
            reject(err instanceof FetchAssetError ? err : new FetchAssetError(`Stream error: ${err.message}`));
          }
        });
      },
    );
    req.on("timeout", () => {
      if (!settled) {
        settled = true;
        req.destroy();
        reject(new FetchAssetError(`Timeout after ${timeoutMs}ms: ${hostname}${path}`));
      }
    });
    req.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(new FetchAssetError(`Request error: ${err.message}`));
      }
    });
    if (signal) {
      if (signal.aborted) {
        if (!settled) {
          settled = true;
          req.destroy();
          reject(new FetchAssetError("Aborted"));
        }
      } else {
        signal.addEventListener(
          "abort",
          () => {
            if (!settled) {
              settled = true;
              req.destroy();
              reject(new FetchAssetError("Aborted"));
            }
          },
          { once: true },
        );
      }
    }
  });
}

/**
 * sha256 hex digest of a buffer, used for asset deduplication.
 *
 * @param {Buffer} buf
 * @returns {string}
 */
export function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}
