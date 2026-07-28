/*
 * A1 (O5.2) — real-time operational alerting. When an operator has configured
 * an alert webhook, POST a JSON alert on operational events (budget breach,
 * stuck-run reap, …) so a human is told when the unattended loop misbehaves,
 * instead of only finding out by looking.
 *
 * Best-effort by design: never throws, timeout-bounded, and a no-op when no
 * webhook is configured. Alerting must NEVER break or slow a run. The webhook
 * URL is operator-set (trusted, like the gh/verify commands) — the server POSTs
 * only to that URL.
 */

// The webhook URL is read live (via getWebhookUrl) so a console edit takes
// effect without a restart. fetchImpl/now are injectable for tests.
export function createAlertDispatcher({
  getWebhookUrl = () => null,
  fetchImpl = globalThis.fetch,
  shouldValidateTarget = () => false,
  resolveHostname = (hostname) => lookup(hostname, { all: true, verbatim: true }),
  now = () => new Date().toISOString(),
  timeoutMs = 5000,
  maxRedirects = 3,
} = {}) {
  async function dispatch({ kind, severity = "warning", message = "", data = {} } = {}) {
    const alert = { kind, severity, message, data };
    let url = typeof getWebhookUrl === "function" ? getWebhookUrl(alert) : null;
    if (!url || typeof fetchImpl !== "function") {
      return { delivery: "skipped", sent: false, reason: "no webhook configured" };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const validateTarget = Boolean(shouldValidateTarget(alert));
      for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
        if (validateTarget) {
          const safe = await validateExternalWebhookTarget(url, { resolveHostname });
          if (!safe.ok) return { delivery: "skipped", sent: false, reason: safe.reason };
        }
        const res = await fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source: "myagenttool-autorun", kind, severity, message, data, at: now() }),
          redirect: "manual",
          signal: controller.signal,
        });
        const status = Number(res?.status ?? 0);
        if (status >= 300 && status < 400) {
          const location = res?.headers?.get?.("location") ?? null;
          if (!location) return { delivery: "skipped", sent: false, status, reason: `HTTP ${status} without Location` };
          if (redirects >= maxRedirects) return { delivery: "skipped", sent: false, status, reason: "too many redirects" };
          url = new URL(location, url).toString();
          continue;
        }
        if (status >= 200 && status < 300) return { delivery: "sent", sent: true, status };
        if (status === 408 || status === 425 || status === 429 || status >= 500 || status === 0) {
          return { delivery: "retryable", sent: false, status, reason: `HTTP ${status || "unknown"}` };
        }
        return { delivery: "skipped", sent: false, status, reason: `HTTP ${status}` };
      }
      return { delivery: "skipped", sent: false, reason: "too many redirects" };
    } catch (error) {
      return { delivery: "retryable", sent: false, reason: String(error?.message ?? error) };
    } finally {
      clearTimeout(timer);
    }
  }
  return { dispatch };
}

export function resolveOwnedAlertWebhookUrl(state, alert, { localTeamId = "team_local" } = {}) {
  const teamId = alert?.data?.teamId ?? null;
  if (!teamId) return state.autoRunSettings?.alertWebhookUrl ?? null;
  const teamUrl = (state.teams ?? []).find((team) => team.id === teamId)?.alertWebhookUrl ?? null;
  if (teamUrl) return teamUrl;
  return teamId === localTeamId ? state.autoRunSettings?.alertWebhookUrl ?? null : null;
}

// Validate an operator-entered webhook URL: http(s) only, trimmed; anything else
// → null (disabled). Keeps a typo from becoming a silent mis-post target.
export function normalizeAlertWebhookUrl(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? trimmed : null;
  } catch {
    return null;
  }
}

function isPrivateIpv4(hostname) {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || parts[0] === 0;
}

// Team owners are less trusted than the machine owner: their targets must be
// external HTTPS endpoints, never credential-bearing or obvious local/private
// destinations. The dispatcher's timeout remains the second safety boundary.
export function normalizeExternalAlertWebhookUrl(value) {
  const normalized = normalizeAlertWebhookUrl(value);
  if (!normalized) return null;
  const url = new URL(normalized);
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const localName = hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || hostname.endsWith(".internal")
    || hostname.endsWith(".lan");
  const privateIpv6 = hostname === "::1"
    || hostname === "::"
    || hostname.startsWith("fc")
    || hostname.startsWith("fd")
    || hostname.startsWith("fe8")
    || hostname.startsWith("fe9")
    || hostname.startsWith("fea")
    || hostname.startsWith("feb");
  if (url.protocol !== "https:" || url.username || url.password || localName || isPrivateIpv4(hostname) || privateIpv6) {
    return null;
  }
  return normalized;
}

export function isPublicWebhookAddress(address) {
  const version = isIP(address);
  if (version === 4) {
    const parts = address.split(".").map(Number);
    return !isPrivateIpv4(address)
      && parts[0] < 224
      && !(parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127);
  }
  if (version === 6) {
    const value = address.toLowerCase();
    if (value.startsWith("::ffff:")) return isPublicWebhookAddress(value.slice(7));
    return value !== "::" && value !== "::1"
      && !value.startsWith("fc") && !value.startsWith("fd")
      && !/^fe[89ab]/.test(value)
      && !value.startsWith("ff");
  }
  return false;
}

export async function validateExternalWebhookTarget(value, { resolveHostname = (hostname) => lookup(hostname, { all: true, verbatim: true }) } = {}) {
  const normalized = normalizeExternalAlertWebhookUrl(value);
  if (!normalized) return { ok: false, reason: "unsafe webhook target" };
  const hostname = new URL(normalized).hostname.replace(/^\[|\]$/g, "");
  try {
    const resolved = isIP(hostname) ? [{ address: hostname }] : await resolveHostname(hostname);
    if (!Array.isArray(resolved) || resolved.length === 0) return { ok: false, reason: "webhook target did not resolve" };
    if (resolved.some((item) => !isPublicWebhookAddress(item?.address ?? ""))) {
      return { ok: false, reason: "webhook target resolved to a non-public address" };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "webhook target could not be resolved" };
  }
}
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
