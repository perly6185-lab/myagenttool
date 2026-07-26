export const QUERY_POLLING = {
  fastProgress: 700,
  activeOperation: 2_000,
  sharedStateFallback: 4_000,
  health: 15_000,
} as const;

export function visiblePolling(intervalMs: number, active = true): number | false {
  if (!active) return false;
  if (typeof document === "undefined") return intervalMs;
  return document.visibilityState === "visible" ? intervalMs : false;
}
