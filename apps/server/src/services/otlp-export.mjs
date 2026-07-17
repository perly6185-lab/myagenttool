import { createHash } from "node:crypto";

import { digestHasSecret } from "./round-telemetry.mjs";

/*
 * ADR 0017 — zero-dependency OTLP/HTTP JSON trace export. Serializes the existing
 * in-memory spans (state.spans) to the OTLP `ExportTraceServiceRequest` JSON
 * shape and best-effort POSTs them to an operator-set endpoint. No
 * `@opentelemetry/*` dependency; the internal span model stays authoritative and
 * this is a fire-and-forget downstream mirror.
 *
 * Span shape (createTrace / createRoundSpan): { id, traceId, parentSpanId, name,
 * status, startedAt, endedAt, attributes }. ids are `trc_…` / `spn_…` strings.
 */

// OTLP wants a 16-byte (32 hex) trace id and an 8-byte (16 hex) span id. Our ids
// are opaque strings, so map them deterministically via a hash — same input →
// same OTLP id across flushes, so a collector threads the tree correctly.
export function otlpTraceId(id) {
  return createHash("sha256").update(String(id)).digest("hex").slice(0, 32);
}
export function otlpSpanId(id) {
  return createHash("sha256").update(String(id)).digest("hex").slice(0, 16);
}

function unixNano(iso) {
  const ms = Date.parse(iso ?? "");
  return Number.isFinite(ms) ? String(ms * 1_000_000) : "0";
}

// OTLP status: 0 UNSET, 1 OK, 2 ERROR. Our span.status is started/succeeded/
// failed/cancelled.
function otlpStatus(status) {
  if (status === "succeeded") return { code: 1 };
  if (status === "failed" || status === "cancelled") return { code: 2 };
  return { code: 0 };
}

// ADR 0017 invariant 4: a span attribute must never carry redactable content.
// Refuse (drop) a string attribute only when it actually matches a secret/PII
// pattern — NOT merely because it is long or empty (redactDigest also truncates
// and nulls empties, so `=== value` used to drop clean-but-long/empty values).
// Non-strings (numbers) pass through as-is.
function attributeSafe(value) {
  if (typeof value !== "string") return true;
  return !digestHasSecret(value);
}

function toKeyValue(attributes) {
  const out = [];
  for (const [key, raw] of Object.entries(attributes ?? {})) {
    if (typeof raw === "string") {
      if (!attributeSafe(raw)) continue; // refuse a would-be-secret attribute
      out.push({ key, value: { stringValue: raw } });
    } else if (typeof raw === "number" && Number.isFinite(raw)) {
      out.push({ key, value: { intValue: String(Math.trunc(raw)) } });
    } else if (typeof raw === "boolean") {
      out.push({ key, value: { boolValue: raw } });
    }
    // objects/null/undefined are skipped — span attributes are flat scalars.
  }
  return out;
}

function toOtlpSpan(span) {
  return {
    traceId: otlpTraceId(span.traceId),
    spanId: otlpSpanId(span.id),
    ...(span.parentSpanId ? { parentSpanId: otlpSpanId(span.parentSpanId) } : {}),
    name: String(span.name ?? "span"),
    kind: 1, // SPAN_KIND_INTERNAL
    startTimeUnixNano: unixNano(span.startedAt),
    endTimeUnixNano: unixNano(span.endedAt ?? span.startedAt),
    attributes: toKeyValue(span.attributes),
    status: otlpStatus(span.status),
  };
}

/**
 * Pure serializer: completed spans → an OTLP ResourceSpans JSON payload. Only
 * spans with an endedAt are exported (an open span has no duration yet).
 */
export function spansToOtlp(spans, { serviceName = "myagenttool" } = {}) {
  const completed = (spans ?? []).filter((s) => s && s.endedAt);
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [{ key: "service.name", value: { stringValue: serviceName } }],
        },
        scopeSpans: [
          {
            scope: { name: "myagenttool.invocation-telemetry" },
            spans: completed.map(toOtlpSpan),
          },
        ],
      },
    ],
  };
}

/**
 * Best-effort OTLP/HTTP JSON exporter. Opt-in via getEndpoint (reads
 * OTEL_EXPORTER_OTLP_ENDPOINT live so an operator edit applies without restart).
 * Never throws, timeout-bounded, no-op when unconfigured — export must never
 * slow or break an invocation.
 */
export function createOtlpTraceExporter({
  getEndpoint = () => process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? null,
  fetchImpl = globalThis.fetch,
  now = () => new Date().toISOString(),
  timeoutMs = 5000,
  serviceName = "myagenttool",
} = {}) {
  async function exportSpans(spans) {
    const endpoint = typeof getEndpoint === "function" ? getEndpoint() : null;
    if (!endpoint || typeof fetchImpl !== "function") return { sent: false, reason: "no endpoint configured" };
    const payload = spansToOtlp(spans, { serviceName });
    if (payload.resourceSpans[0].scopeSpans[0].spans.length === 0) return { sent: false, reason: "no completed spans" };
    const count = payload.resourceSpans[0].scopeSpans[0].spans.length;
    // OTLP/HTTP traces path.
    const url = endpoint.replace(/\/+$/, "") + "/v1/traces";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const status = Number.isInteger(res?.status) ? res.status : null;
      if (status !== null && status >= 200 && status < 300) {
        return { sent: true, status, count };
      }
      // A response body may contain collector internals or echoed credentials;
      // do not read or surface it. The stable reason is enough for callers to
      // decide whether the batch must remain pending.
      return { sent: false, status, count, reason: "http_status" };
    } catch {
      // Never expose fetch errors: they commonly include the destination URL.
      // This controller is private to the timeout, so an aborted signal is a
      // deterministic timeout classification; every other throw is network I/O.
      return {
        sent: false,
        status: null,
        count,
        reason: controller.signal.aborted ? "timeout" : "network_error",
      };
    } finally {
      clearTimeout(timer);
    }
  }
  return { exportSpans };
}
