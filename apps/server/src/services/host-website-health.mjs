import { createHash } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { checkServerIdentity } from "node:tls";

const MAX_HEALTH_BYTES = 25 * 1024 * 1024;
const SAFE_HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const SHA256_HEX = /^[a-f0-9]{64}$/;

export class HostWebsiteHealthCheckError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "HostWebsiteHealthCheckError";
    this.code = code;
  }
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function validateInput(input, stagingCaPem) {
  const address = String(input?.address ?? "").trim();
  const hostname = String(input?.hostname ?? "").trim().toLowerCase();
  const certificateFingerprint = String(input?.certificateFingerprint ?? "").trim().toLowerCase();
  const expectedContentHash = String(input?.expectedContentHash ?? "").trim().toLowerCase();
  const expectedContentBytes = Number(input?.expectedContentBytes);
  if (!isIP(address) || !SAFE_HOSTNAME.test(hostname) || !SHA256_HEX.test(certificateFingerprint) || !SHA256_HEX.test(expectedContentHash)) {
    throw new HostWebsiteHealthCheckError("host_website_health_target_invalid", "The managed website health target is incomplete.");
  }
  if (!Number.isSafeInteger(expectedContentBytes) || expectedContentBytes < 1 || expectedContentBytes > MAX_HEALTH_BYTES) {
    throw new HostWebsiteHealthCheckError("host_website_health_content_invalid", "The managed website content receipt is invalid.");
  }
  const environment = input?.certificateEnvironment === "staging" ? "staging" : "production";
  if (environment === "staging" && !String(stagingCaPem ?? "").includes("BEGIN CERTIFICATE")) {
    throw new HostWebsiteHealthCheckError("host_website_staging_ca_unavailable", "The staging HTTPS trust anchor is unavailable.");
  }
  return { address, hostname, certificateFingerprint, expectedContentHash, expectedContentBytes, environment };
}

function reasonForConnectionError(error) {
  const code = String(error?.code ?? "").toUpperCase();
  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") return "website_timeout";
  if (["ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "ECONNRESET"].includes(code)) return "website_unreachable";
  if (/CERT|TLS|SSL|ALTNAME|SELF_SIGNED/.test(code)) return "website_certificate_invalid";
  return "website_unreachable";
}

export function createPinnedWebsiteHealthChecker({
  httpsRequestImpl = httpsRequest,
  stagingCaPem = "",
  timeoutMs = 15_000,
  now = () => new Date().toISOString(),
} = {}) {
  if (typeof httpsRequestImpl !== "function") throw new TypeError("An HTTPS request implementation is required");

  return async function checkPinnedWebsiteHealth(input) {
    const target = validateInput(input, stagingCaPem);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve({ checkedAt: now(), ...value });
      };
      const request = httpsRequestImpl({
        hostname: target.address,
        port: 443,
        servername: target.hostname,
        method: "GET",
        path: "/",
        headers: { Host: target.hostname, Accept: "text/html", "Cache-Control": "no-cache" },
        timeout: timeoutMs,
        rejectUnauthorized: true,
        checkServerIdentity,
        ...(target.environment === "staging" ? { ca: stagingCaPem } : {}),
      }, (response) => {
        const peer = response.socket?.getPeerCertificate?.(true);
        const actualFingerprint = peer?.raw ? digest(peer.raw) : null;
        if (actualFingerprint !== target.certificateFingerprint) {
          response.resume();
          finish({ status: "unhealthy", reason: "website_certificate_mismatch", statusCodeClass: null, contentMatched: false });
          return;
        }
        const status = Number(response.statusCode ?? 0);
        if (status < 200 || status >= 300) {
          response.resume();
          finish({ status: "unhealthy", reason: "website_http_error", statusCodeClass: status >= 100 && status < 600 ? Math.floor(status / 100) : null, contentMatched: false });
          return;
        }
        const declared = Number(response.headers?.["content-length"] ?? NaN);
        if (Number.isFinite(declared) && (declared !== target.expectedContentBytes || declared > MAX_HEALTH_BYTES)) {
          response.resume();
          finish({ status: "unhealthy", reason: "website_content_mismatch", statusCodeClass: 2, contentMatched: false });
          return;
        }
        const chunks = [];
        let received = 0;
        response.on("data", (chunk) => {
          received += chunk.length;
          if (received > MAX_HEALTH_BYTES || received > target.expectedContentBytes) {
            response.destroy();
            finish({ status: "unhealthy", reason: "website_content_mismatch", statusCodeClass: 2, contentMatched: false });
          } else {
            chunks.push(Buffer.from(chunk));
          }
        });
        response.once("end", () => {
          if (settled) return;
          const bytes = Buffer.concat(chunks, received);
          const matched = received === target.expectedContentBytes && digest(bytes) === target.expectedContentHash;
          finish({ status: matched ? "healthy" : "unhealthy", reason: matched ? "website_healthy" : "website_content_mismatch", statusCodeClass: 2, contentMatched: matched });
        });
        response.once("error", (error) => finish({ status: "unhealthy", reason: reasonForConnectionError(error), statusCodeClass: null, contentMatched: false }));
      });
      request.once("timeout", () => request.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })));
      request.once("error", (error) => finish({ status: "unhealthy", reason: reasonForConnectionError(error), statusCodeClass: null, contentMatched: false }));
      request.end();
    });
  };
}
