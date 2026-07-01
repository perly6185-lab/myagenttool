/*
 * Automation schedule helpers, shared by the CRUD routes (which stamp
 * `nextRunAt`) and the scheduler tick (which fires and re-stamps). Keeping them
 * in one place is what makes "when it was stamped" agree with "when it fires".
 */

/** Coerce a raw schedule into one of the three supported shapes + a UI label. */
export function normalizeSchedule(value = {}) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const kind = ["interval", "daily", "weekdays"].includes(raw.kind) ? raw.kind : "weekdays";
  if (kind === "interval") {
    const everyMinutes = Math.max(1, Math.floor(Number(raw.everyMinutes ?? 60)));
    return { kind, everyMinutes, label: `Every ${everyMinutes} minutes` };
  }
  const time = /^\d{2}:\d{2}$/.test(String(raw.time ?? "")) ? String(raw.time) : "09:00";
  return { kind, time, label: kind === "daily" ? `Daily at ${time}` : `Weekdays at ${time}` };
}

/**
 * The next fire time for a schedule as an ISO string, or null if it can't run.
 * `interval` adds N minutes; `daily`/`weekdays` land on the configured HH:MM
 * (tomorrow if today's time has passed), and `weekdays` skips Sat/Sun.
 */
export function computeNextRun(schedule, fromMs = Date.now()) {
  if (!schedule) return null;
  if (schedule.kind === "interval") {
    const m = Number(schedule.everyMinutes) || 0;
    return m > 0 ? new Date(fromMs + m * 60_000).toISOString() : null;
  }
  const [hh, mm] = String(schedule.time ?? "09:00").split(":").map((n) => Number(n) || 0);
  const cand = new Date(fromMs);
  cand.setHours(hh, mm, 0, 0);
  if (cand.getTime() <= fromMs) cand.setDate(cand.getDate() + 1);
  if (schedule.kind === "weekdays") {
    while (cand.getDay() === 0 || cand.getDay() === 6) cand.setDate(cand.getDate() + 1);
  }
  return cand.toISOString();
}
