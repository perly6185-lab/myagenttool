/*
 * #250: the trend-derived gate line. Policy under test: clean points only,
 * most-recent window, >= minRuns to derive, floor = observedMin - margin
 * ratcheted at the provisional baseline (derived lines tighten, never loosen),
 * fallback labelled when data is thin.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { deriveFloors, FLOOR_DERIVATION, PROVISIONAL_FLOORS } from "../src/evals/eval-signals.mjs";

const run = (subcapRate, heldoutRate = null, extra = {}) => ({
  startedAt: "2026-07-10T00:00:00Z",
  subcap: Number.isFinite(subcapRate) ? { passRate: subcapRate, byKind: { "issue-gate": { total: 6, resolved: 6 }, "pm-brief": { total: 6, resolved: 6 }, review: { total: 3, resolved: 3 } } } : undefined,
  ...(Number.isFinite(heldoutRate) ? { heldout: { passRate: heldoutRate } } : {}),
  ...extra,
});

test("fewer than minRuns clean points -> the provisional fallback, labelled", () => {
  const { floors, meta } = deriveFloors([run(1), run(0.93)]);
  assert.equal(floors.subcap, PROVISIONAL_FLOORS.subcap);
  assert.equal(meta.subcap.derived, false);
  assert.equal(meta.subcap.n, 2);
  assert.equal(meta.subcap.needed, FLOOR_DERIVATION.minRuns);
});

test("the documented 2026-07-07 hand-derivation reproduces exactly (1.0, 0.93, 1.0 -> 0.80)", () => {
  const { floors, meta } = deriveFloors([run(1), run(0.93), run(1)]);
  assert.equal(floors.subcap, 0.8, "min 0.93 - 0.13 margin = 0.80");
  assert.equal(meta.subcap.derived, true);
  assert.equal(meta.subcap.observedMin, 0.93);
});

test("a strong window TIGHTENS the line above the provisional baseline", () => {
  const { floors } = deriveFloors([run(1), run(1), run(0.98)]);
  assert.equal(floors.subcap, 0.85, "0.98 - 0.13 = 0.85 > provisional 0.80");
});

test("a degraded window never LOOSENS the line below the baseline (ratchet)", () => {
  const { floors, meta } = deriveFloors([run(0.7), run(0.72), run(0.71)]);
  assert.equal(floors.subcap, PROVISIONAL_FLOORS.subcap, "0.70 - 0.13 = 0.57 would loosen the gate; the ratchet holds 0.80");
  assert.equal(meta.subcap.derived, true, "still labelled derived — the ratchet is policy, not missing data");
});

test("auth/infra rows never shape a line", () => {
  const { floors, meta } = deriveFloors([
    run(1), run(0.93),
    { startedAt: "x", authFailure: true, infraFailure: true, subcap: { passRate: 0.1 } },
    { startedAt: "y", subcap: { passRate: 0.05, byKind: { "issue-gate": { total: 6, resolved: 6 }, "pm-brief": { total: 6, resolved: 0 }, review: { total: 3, resolved: 0 } } } }, // infra fingerprint
  ]);
  assert.equal(meta.subcap.n, 2, "only the two clean points count");
  assert.equal(floors.subcap, PROVISIONAL_FLOORS.subcap);
});

test("only the most recent `window` points shape the line", () => {
  const old = [run(0.5), run(0.5), run(0.5)];
  const recent = [run(1), run(1), run(1), run(1), run(0.95)];
  const { floors, meta } = deriveFloors([...old, ...recent]);
  assert.equal(meta.subcap.observedMin, 0.95, "the 0.5 era fell out of the window");
  assert.equal(floors.subcap, 0.82);
});

test("metrics derive independently: heldout stays provisional while subcap derives", () => {
  const { floors, meta } = deriveFloors([run(1, 0.9), run(0.93), run(1)]);
  assert.equal(meta.subcap.derived, true);
  assert.equal(meta.heldout.derived, false, "one heldout point is not a line");
  assert.equal(floors.heldout, PROVISIONAL_FLOORS.heldout);
});
