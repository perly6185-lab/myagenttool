// Small display formatters shared by the console. Kept separate from
// readable-labels (status/label text) and money (USD) so token/duration
// formatting has one home.

/** Thousands-separated token count. Non-finite → "0". */
export function formatTokens(value?: number | null): string {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toLocaleString() : "0";
}

/** Human duration from milliseconds: "820ms", "5.0s", "1m 12s". Null → "—". */
export function formatDuration(ms?: number | null): string {
  if (ms == null) return "—";
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1000) return `${Math.round(n)}ms`;
  const seconds = n / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}
