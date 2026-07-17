/*
 * #1174 (R2 of #1170): dispatchEvaluation read model. Aggregates the
 * dispatcher's own assignment lifecycle per worker and per (worker × area),
 * with the honest-indeterminate boundary — a slice below the settled-sample
 * threshold reports no rate rather than an extrapolated one. Pure; no server.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { computeDispatchEvaluation } from "../src/read-models/dispatch-evaluation.mjs";

const T0 = "2026-07-17T00:00:00.000Z";
const plusMin = (m) => new Date(Date.parse(T0) + m * 60_000).toISOString();

function row(overrides = {}) {
  return {
    projectId: "prj",
    issueNumber: overrides.issueNumber ?? 1,
    workerId: overrides.workerId ?? "desk",
    status: overrides.status ?? "open",
    assignedAt: overrides.assignedAt ?? T0,
    completedAt: overrides.completedAt ?? null,
    expiredAt: overrides.expiredAt ?? null,
    routing: { requirements: { areas: overrides.areas ?? [] } },
    ...overrides,
  };
}

test("#1174 empty input yields an all-indeterminate total", () => {
  const evalResult = computeDispatchEvaluation([]);
  assert.equal(evalResult.total.assignments, 0);
  assert.equal(evalResult.total.verdict, "indeterminate");
  assert.equal(evalResult.total.completionRate, null);
  assert.deepEqual(evalResult.workers, []);
});

test("#1174 a slice below minSamples settled outcomes is indeterminate, never an extrapolated rate", () => {
  // 3 completed, 0 reassigned → 3 settled < default 10 → indeterminate.
  const rows = [1, 2, 3].map((n) => row({ issueNumber: n, status: "completed", completedAt: plusMin(30), areas: ["server"] }));
  const evalResult = computeDispatchEvaluation(rows);
  const desk = evalResult.workers.find((w) => w.worker === "desk");
  assert.equal(desk.assignments, 3);
  assert.equal(desk.completed, 3);
  assert.equal(desk.verdict, "indeterminate");
  assert.equal(desk.completionRate, null, "no rate below threshold");
  assert.equal(desk.sample, "n=3");
});

test("#1174 past the threshold, completion/reassignment rates and median settle are computed", () => {
  const rows = [];
  // 8 completed @ 20m, 2 expired → 10 settled = threshold met.
  for (let i = 0; i < 8; i++) rows.push(row({ issueNumber: i, status: "completed", completedAt: plusMin(20), areas: ["web"] }));
  for (let i = 8; i < 10; i++) rows.push(row({ issueNumber: i, status: "expired", expiredAt: plusMin(200), areas: ["web"] }));
  const evalResult = computeDispatchEvaluation(rows);
  const desk = evalResult.workers.find((w) => w.worker === "desk");
  assert.equal(desk.verdict, "measured");
  assert.equal(desk.completionRate, 0.8);
  assert.equal(desk.reassignmentRate, 0.2);
  assert.equal(desk.medianMinutesToSettle, 20, "median over the completed settle times");
  const web = evalResult.workerAreas.find((s) => s.worker === "desk" && s.area === "web");
  assert.equal(web.completionRate, 0.8, "per-area slice mirrors the worker when all issues share one area");
});

test("#1174 an issue with multiple areas counts toward each area slice; unspecified is its own bucket", () => {
  const rows = [
    row({ issueNumber: 1, status: "completed", completedAt: plusMin(10), areas: ["server", "web"] }),
    row({ issueNumber: 2, status: "completed", completedAt: plusMin(10), areas: [] }),
  ];
  const evalResult = computeDispatchEvaluation(rows);
  const server = evalResult.workerAreas.find((s) => s.area === "server");
  const web = evalResult.workerAreas.find((s) => s.area === "web");
  const none = evalResult.workerAreas.find((s) => s.area === "(unspecified)");
  assert.equal(server.assignments, 1);
  assert.equal(web.assignments, 1, "the same issue is in both server and web slices");
  assert.equal(none.assignments, 1, "the area-less issue lands in (unspecified)");
  assert.equal(evalResult.total.assignments, 2, "the worker total is unduplicated");
});

test("#1174 open (unsettled) assignments never inflate rates and time-to-PR stays out of scope", () => {
  const rows = [
    ...Array.from({ length: 10 }, (_, i) => row({ issueNumber: i, status: "completed", completedAt: plusMin(15), areas: ["server"] })),
    row({ issueNumber: 99, status: "open", areas: ["server"] }),
  ];
  const evalResult = computeDispatchEvaluation(rows);
  const desk = evalResult.workers.find((w) => w.worker === "desk");
  assert.equal(desk.open, 1);
  assert.equal(desk.settled, 10, "rates are over settled outcomes, open work is excluded");
  assert.equal(desk.completionRate, 1);
  assert.deepEqual(evalResult.unmeasured, ["time_to_in_progress", "time_to_pr"], "cross-server metrics declared out of scope, not faked");
});

test("#1174 a custom minSamples threshold gates the verdict", () => {
  const rows = [1, 2, 3].map((n) => row({ issueNumber: n, status: "completed", completedAt: plusMin(5), areas: ["web"] }));
  const strict = computeDispatchEvaluation(rows, { minSamples: 10 });
  const loose = computeDispatchEvaluation(rows, { minSamples: 3 });
  assert.equal(strict.workers[0].verdict, "indeterminate");
  assert.equal(loose.workers[0].verdict, "measured");
  assert.equal(loose.workers[0].completionRate, 1);
});

// ── #1180 R3: shadow-mode counterfactual evaluation ──────────────────────────

function shadowRow(overrides = {}) {
  return row({
    ...overrides,
    routing: { requirements: { areas: overrides.areas ?? [] }, shadow: { baseline: overrides.baseline, scored: overrides.scored, agree: overrides.baseline === overrides.scored } },
  });
}

test("#1180 shadow block: no shadow rows → indeterminate, no rate claimed", () => {
  const evalResult = computeDispatchEvaluation([row({ status: "completed", completedAt: plusMin(10) })]);
  assert.equal(evalResult.shadow.shadowAssignments, 0);
  assert.equal(evalResult.shadow.verdict, "indeterminate");
  assert.equal(evalResult.shadow.baselineReassignRate, null);
  assert.equal(evalResult.shadow.agreementRate, null, "#1184: no confident rate off zero samples");
});

test("#1180/#1184 shadow: per-issue baseline-reassign rate over settled diverged issues, gated by threshold", () => {
  const rows = [];
  // 6 agreements (both picked 'a'), completed.
  for (let i = 0; i < 6; i++) rows.push(shadowRow({ issueNumber: i, baseline: "a", scored: "a", status: "completed", completedAt: plusMin(10) }));
  // 12 diverged (baseline 'a', scored 'b'): 9 baseline reassigned, 3 baseline completed.
  for (let i = 6; i < 15; i++) rows.push(shadowRow({ issueNumber: i, baseline: "a", scored: "b", status: "expired", expiredAt: plusMin(200) }));
  for (let i = 15; i < 18; i++) rows.push(shadowRow({ issueNumber: i, baseline: "a", scored: "b", status: "completed", completedAt: plusMin(30) }));
  const s = computeDispatchEvaluation(rows).shadow;
  assert.equal(s.shadowAssignments, 18);
  assert.equal(s.disagreements, 12);
  assert.equal(s.agreementRate, 0.33, "6 of 18 agreed (≥ threshold → measured)");
  assert.equal(s.settledDisagreements, 12);
  assert.equal(s.verdict, "measured", "12 settled diverged ≥ 10 threshold");
  assert.equal(s.baselineReassignRate, 0.75, "9 of 12 baseline divergent picks were reassigned");
  assert.match(s.promotionRule, /confirm it reflects routing, not a short assignment TTL/, "TTL-churn caveat carried");
});

test("#1184 shadow: repeated TTL churn of ONE issue counts once, not per tick", () => {
  const rows = [];
  // One stubborn issue #7 churns 20 times (newest first): all expired, baseline≠scored.
  for (let tick = 20; tick >= 1; tick--) {
    rows.push(shadowRow({ issueNumber: 7, baseline: "a", scored: "b", status: tick === 20 ? "expired" : "expired", expiredAt: plusMin(tick * 10) }));
  }
  const s = computeDispatchEvaluation(rows).shadow;
  assert.equal(s.shadowAssignments, 1, "20 churn rows for one issue collapse to one diverged issue");
  assert.equal(s.settledDisagreements, 1);
  assert.equal(s.verdict, "indeterminate", "a single pathological issue can no longer trip the gate");
  assert.equal(s.baselineReassignRate, null);
});

test("#1184 shadow: agreementRate honors minSamples (no 100% off n=1)", () => {
  const one = computeDispatchEvaluation([shadowRow({ issueNumber: 1, baseline: "a", scored: "a", status: "completed", completedAt: plusMin(5) })]);
  assert.equal(one.shadow.shadowAssignments, 1);
  assert.equal(one.shadow.agreementRate, null, "n=1 → withheld, not a confident 100%");
  // 10 agreeing issues → past threshold → rate emitted.
  const rows = Array.from({ length: 10 }, (_, i) => shadowRow({ issueNumber: i, baseline: "a", scored: "a", status: "completed", completedAt: plusMin(5) }));
  assert.equal(computeDispatchEvaluation(rows).shadow.agreementRate, 1);
});

test("#1180 shadow: below the settled-diverged threshold, the reassign rate is withheld", () => {
  const rows = [];
  for (let i = 0; i < 5; i++) rows.push(shadowRow({ issueNumber: i, baseline: "a", scored: "b", status: "expired", expiredAt: plusMin(200) }));
  const s = computeDispatchEvaluation(rows).shadow;
  assert.equal(s.settledDisagreements, 5);
  assert.equal(s.verdict, "indeterminate");
  assert.equal(s.baselineReassignRate, null, "5 < 10 → no rate");
});
