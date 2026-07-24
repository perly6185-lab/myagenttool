import { makeRunTx } from "../runtime/store/run-tx.mjs";

const MAX_ATTEMPTS = 8;
const MAX_ROWS = 1_000;

export function createAlertOutboxService({
  state,
  now,
  nextId,
  dispatch,
  persistStateSoon,
  store,
} = {}) {
  const runTx = makeRunTx({ store, persistStateSoon });

  function enqueue(alert = {}) {
    const row = {
      id: nextId("aob"),
      alert,
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
      .filter((row) => row.status !== "sent" && row.attempts < MAX_ATTEMPTS && Date.parse(row.nextAttemptAt) <= Date.parse(now()))
      .slice(-limit);
    let sent = 0;
    for (const row of due) {
      const result = await dispatch(row.alert);
      runTx(() => {
        row.attempts += 1;
        if (result?.sent) {
          row.status = "sent";
          row.sentAt = now();
          row.lastError = null;
          sent += 1;
        } else {
          row.status = row.attempts >= MAX_ATTEMPTS ? "failed" : "queued";
          row.lastError = String(result?.reason ?? `HTTP ${result?.status ?? "unknown"}`).slice(0, 500);
          row.nextAttemptAt = new Date(Date.parse(now()) + Math.min(60_000 * 2 ** row.attempts, 3_600_000)).toISOString();
        }
      });
    }
    return { attempted: due.length, sent };
  }

  return { enqueue, sweep };
}
