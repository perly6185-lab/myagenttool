import { makeRunTx } from "../runtime/store/run-tx.mjs";

const MAX_ATTEMPTS = 8;
const MAX_ROWS = 1_000;

export function createAlertOutboxService({
  state,
  now,
  nextId,
  dispatch,
  enrichAlert = (alert) => alert,
  persistStateSoon,
  store,
} = {}) {
  const runTx = makeRunTx({ store, persistStateSoon });

  function enqueue(alert = {}) {
    const attributedAlert = enrichAlert(alert) ?? alert;
    const row = {
      id: nextId("aob"),
      alert: attributedAlert,
      status: "queued",
      attempts: 0,
      nextAttemptAt: now(),
      createdAt: now(),
      sentAt: null,
      lastError: null,
    };
    runTx(() => {
      (state.alertOutbox ??= []).unshift(row);
      state.alertOutbox = state.alertOutbox.slice(0, MAX_ROWS);
    });
    return row;
  }

  async function sweep({ limit = 20 } = {}) {
    const due = (state.alertOutbox ?? [])
      .filter((row) => !["sent", "skipped"].includes(row.status) && row.attempts < MAX_ATTEMPTS && Date.parse(row.nextAttemptAt) <= Date.parse(now()))
      .slice(-limit);
    let sent = 0;
    for (const row of due) {
      const result = await dispatch(row.alert);
      runTx(() => {
        row.attempts += 1;
        const delivery = result?.delivery ?? (result?.sent ? "sent" : "retryable");
        if (delivery === "sent") {
          row.status = "sent";
          row.sentAt = now();
          row.lastError = null;
          sent += 1;
        } else if (delivery === "skipped") {
          row.status = "skipped";
          row.lastError = String(result?.reason ?? `HTTP ${result?.status ?? "unknown"}`).slice(0, 500);
          row.nextAttemptAt = null;
        } else {
          row.status = row.attempts >= MAX_ATTEMPTS ? "failed" : "queued";
          row.lastError = String(result?.reason ?? `HTTP ${result?.status ?? "unknown"}`).slice(0, 500);
          row.nextAttemptAt = new Date(Date.parse(now()) + Math.min(60_000 * 2 ** row.attempts, 3_600_000)).toISOString();
        }
      });
    }
    return { attempted: due.length, sent };
  }

  function retry(alertId) {
    const row = (state.alertOutbox ?? []).find((candidate) => candidate.id === String(alertId));
    if (!row || !["failed", "skipped"].includes(row.status)) return null;
    runTx(() => {
      row.status = "queued";
      row.attempts = 0;
      row.nextAttemptAt = now();
      row.sentAt = null;
      row.lastError = null;
    });
    return row;
  }

  return { enqueue, sweep, retry };
}
