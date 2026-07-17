import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeAutoRunSlos, DEFAULT_SLO_TARGETS, evaluateSloAlert } from "../src/services/auto-run-slo.mjs";

const find = (r, k) => r.slos.find((s) => s.key === k);

test("empty input: all values null, meets null, nothing below", () => {
  const r = summarizeAutoRunSlos([]);
  assert.equal(find(r, "prSuccessRate").value, null);
  assert.equal(find(r, "prSuccessRate").meets, null);
  assert.equal(r.anyBelow, false, "no data is never a false 'below'");
});

test("prSuccessRate = prOpen / code-terminal; below target flags", () => {
  // 1 pr_open, 3 failed → 1/4 = 0.25 < 0.7 target → below
  const r = summarizeAutoRunSlos([
    { status: "pr_open", createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:05:00Z" },
    { status: "failed" }, { status: "failed" }, { status: "failed" },
  ]);
  assert.equal(find(r, "prSuccessRate").value, 0.25);
  assert.equal(find(r, "prSuccessRate").meets, false);
  assert.equal(r.anyBelow, true);
});

test("failureRate lte target; time-to-PR median from pr_open runs", () => {
  const r = summarizeAutoRunSlos([
    { status: "pr_open", createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:10:00Z" }, // 600s
    { status: "pr_open", createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:20:00Z" }, // 1200s
  ]);
  assert.equal(find(r, "failureRate").value, 0, "no failures");
  assert.equal(find(r, "failureRate").meets, true);
  assert.equal(find(r, "timeToPrMedianSeconds").value, 900, "median of 600 & 1200");
  assert.equal(find(r, "timeToPrMedianSeconds").meets, true, "900 <= 1800 target");
});

test("attentionRate counts approval/blocked/needs_input over total", () => {
  const r = summarizeAutoRunSlos([
    { status: "awaiting_approval" }, { status: "blocked" }, { status: "pr_open", createdAt: "a", updatedAt: "a" }, { status: "pr_open" },
  ]);
  assert.equal(find(r, "attentionRate").value, 0.5, "2 of 4 need a human");
  assert.equal(DEFAULT_SLO_TARGETS.attentionRate, 0.5);
});

// --- SLO → alert loop (O5.2 follow-up) ---------------------------------------

test("evaluateSloAlert: no data (meets null) never alerts", () => {
  const summary = summarizeAutoRunSlos([]); // all values null
  const r = evaluateSloAlert(summary, "");
  assert.equal(r.changed, false);
  assert.equal(r.alert, null);
  assert.equal(r.signature, "");
});

test("evaluateSloAlert: a fresh breach alerts once, then is throttled while unchanged", () => {
  const summary = { slos: [
    { key: "failureRate", label: "Failure rate", value: 0.9, target: 0.2, direction: "lte", unit: "ratio", meets: false },
    { key: "prSuccessRate", label: "PR success rate", value: 0.9, target: 0.7, direction: "gte", unit: "ratio", meets: true },
  ] };
  const first = evaluateSloAlert(summary, "");
  assert.equal(first.changed, true);
  assert.equal(first.alert.kind, "auto_run_slo_below");
  assert.equal(first.alert.severity, "warning");
  assert.deepEqual(first.alert.data.below.map((b) => b.key), ["failureRate"]);
  assert.equal(first.signature, "failureRate");

  // Same breach set on the next tick → throttled, no alert.
  const again = evaluateSloAlert(summary, first.signature);
  assert.equal(again.changed, false);
  assert.equal(again.alert, null);
});

test("evaluateSloAlert: the below-target set changing re-alerts", () => {
  const worse = { slos: [
    { key: "failureRate", label: "Failure rate", meets: false, value: 0.9, target: 0.2, direction: "lte", unit: "ratio" },
    { key: "prSuccessRate", label: "PR success rate", meets: false, value: 0.1, target: 0.7, direction: "gte", unit: "ratio" },
  ] };
  const r = evaluateSloAlert(worse, "failureRate");
  assert.equal(r.changed, true);
  assert.equal(r.signature, "failureRate,prSuccessRate", "keys are sorted for a stable signature");
  assert.deepEqual(r.alert.data.below.map((b) => b.key).sort(), ["failureRate", "prSuccessRate"]);
});

test("evaluateSloAlert: a breach going to NO DATA clears the signature WITHOUT a false 'recovered'", () => {
  // Every SLO meets===null (e.g. an empty loop after a restart, breach signature
  // still persisted). This is not a recovery.
  const noData = { slos: [
    { key: "failureRate", label: "Failure rate", meets: null, value: null, target: 0.2, direction: "lte", unit: "ratio" },
  ] };
  const r = evaluateSloAlert(noData, "failureRate");
  assert.equal(r.changed, true, "the stale breach signature is cleared");
  assert.equal(r.signature, "");
  assert.equal(r.alert, null, "no false 'back on target' alert when there is no data");
});

test("evaluateSloAlert: recovery from a breach emits an info alert and clears the signature", () => {
  const healthy = { slos: [
    { key: "failureRate", label: "Failure rate", meets: true, value: 0.1, target: 0.2, direction: "lte", unit: "ratio" },
  ] };
  const r = evaluateSloAlert(healthy, "failureRate");
  assert.equal(r.changed, true);
  assert.equal(r.signature, "");
  assert.equal(r.alert.kind, "auto_run_slo_recovered");
  assert.equal(r.alert.severity, "info");
  assert.deepEqual(r.alert.data.previouslyBelow, ["failureRate"]);
});
