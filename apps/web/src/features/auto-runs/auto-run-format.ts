export function formatAutoRunDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

export function formatAutoRunSloValue(value: number | null, unit: "ratio" | "seconds"): string {
  if (value == null) return "—";
  return unit === "ratio" ? `${Math.round(value * 100)}%` : formatAutoRunDuration(value);
}
