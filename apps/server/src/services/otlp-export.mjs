import { createHash } from "node:crypto";

import { redactDigest } from "./round-telemetry.mjs";

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
// redactDigest returns the value unchanged when it holds no secret/PII; if it
// changes, the value would leak — refuse to export that attribute (drop it),
// never send it. Non-strings (numbers) pass through as-is.
function attributeSafe(value) {
  if (typeof value !== "string") return true;
  return redactDigest(value) === value;
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
      return { sent: true, status: res?.status ?? null, count: payload.resourceSpans[0].scopeSpans[0].spans.length };
    } catch (error) {
      return { sent: false, reason: String(error?.message ?? error) };
    } finally {
      clearTimeout(timer);
    }
  }
  return { exportSpans };
}
