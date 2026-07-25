function percentile(values, quantile) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))];
}

export function summarizeApplicationResolution(rows = []) {
  const samples = (Array.isArray(rows) ? rows : [])
    .filter((row) => Number.isFinite(row?.durationMs) && row.durationMs >= 0)
    .slice(-500);
  const durations = samples.map((row) => row.durationMs);
  const waiting = samples.filter((row) =>
    ["waiting_capability", "waiting_approval", "waiting_capacity", "refusal"].includes(row.state)).length;
  const p95Ms = percentile(durations, 0.95);
  return {
    sampleCount: samples.length,
    p50Ms: percentile(durations, 0.5),
    p95Ms,
    waitingRate: samples.length ? Math.round((waiting / samples.length) * 10_000) / 100 : null,
    alerting: p95Ms != null && p95Ms > 500,
    thresholdMs: 500,
  };
}
