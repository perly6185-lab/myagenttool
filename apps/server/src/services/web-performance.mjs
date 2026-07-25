const METRICS = new Set(["CLS", "FCP", "INP", "LCP"]);
const RATINGS = new Set(["good", "needs-improvement", "poor"]);

export function normalizeWebPerformanceMetric(input, context = {}) {
  const name = String(input?.name ?? "").toUpperCase();
  const value = Number(input?.value);
  if (!METRICS.has(name) || !Number.isFinite(value) || value < 0) return null;
  const rating = RATINGS.has(input?.rating) ? input.rating : "needs-improvement";
  return {
    id: context.id,
    name,
    value: Math.round(value * 100) / 100,
    rating,
    path: String(input?.path ?? "/").slice(0, 500),
    version: String(input?.version ?? "dev").slice(0, 100),
    userId: context.userId ?? null,
    teamId: context.teamId ?? null,
    recordedAt: context.recordedAt,
  };
}

export function summarizeWebPerformance(rows, { version = null, limit = 50 } = {}) {
  const filtered = rows
    .filter((row) => !version || row.version === version)
    .slice(-Math.max(1, Math.min(500, limit)));
  const metrics = {};
  for (const name of METRICS) {
    const samples = filtered.filter((row) => row.name === name).map((row) => row.value).sort((a, b) => a - b);
    if (!samples.length) continue;
    const p75 = samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.75) - 1)];
    const poor = filtered.filter((row) => row.name === name && row.rating === "poor").length;
    metrics[name] = {
      samples: samples.length,
      p75,
      poor,
      poorRate: Math.round((poor / samples.length) * 10_000) / 100,
      alerting: poor > 0,
    };
  }
  const versions = [...new Set(rows.map((row) => row.version))].slice(-10);
  return { metrics, versions, sampleCount: filtered.length };
}
