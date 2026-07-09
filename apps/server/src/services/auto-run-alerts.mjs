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
  now = () => new Date().toISOString(),
  timeoutMs = 5000,
} = {}) {
  async function dispatch({ kind, severity = "warning", message = "", data = {} } = {}) {
    const url = typeof getWebhookUrl === "function" ? getWebhookUrl() : null;
    if (!url || typeof fetchImpl !== "function") return { sent: false, reason: "no webhook configured" };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "myagenttool-autorun", kind, severity, message, data, at: now() }),
        signal: controller.signal,
      });
      return { sent: true, status: res?.status ?? null };
    } catch (error) {
      return { sent: false, reason: String(error?.message ?? error) };
    } finally {
      clearTimeout(timer);
    }
  }
  return { dispatch };
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
