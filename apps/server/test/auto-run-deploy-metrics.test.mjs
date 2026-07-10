/*
 * Deploy metrics (D2): pure summary over the deployments collection — change-
 * failure rate, recovery time (failure → first later success), deploy frequency.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { summarizeDeployments } from "../src/services/auto-run-deploy-metrics.mjs";

const H = 3_600_000;
const D = 86_400_000;
const t = (ms) => new Date(ms).toISOString();
const BASE = Date.parse("2026-07-01T00:00:00Z");

test("summarizeDeployments: empty / invalid rows -> all null", () => {
  const s = summarizeDeployments([]);
  assert.equal(s.total, 0);
  assert.equal(s.changeFailureRate, null);
  assert.equal(s.recoveryHours.median, null);
  assert.equal(s.deployFrequencyPerWeek, null);
  assert.equal(summarizeDeployments([{ status: "x", at: "bad" }]).total, 0, "invalid rows ignored");
});

test("summarizeDeployments: change-failure rate = failed / total", () => {
  const s = summarizeDeployments([
    { status: "deployed", at: t(BASE) },
    { status: "failed", at: t(BASE + D) },
    { status: "deployed", at: t(BASE + 2 * D) },
    { status: "deployed", at: t(BASE + 3 * D) },
  ]);
  assert.equal(s.total, 4);
  assert.equal(s.deployed, 3);
  assert.equal(s.failed, 1);
  assert.equal(s.changeFailureRate, 0.25);
});

test("summarizeDeployments: recovery = failure -> first later success (median across failures)", () => {
  const s = summarizeDeployments([
    { status: "failed", at: t(BASE) }, // recovered 2h later
    { status: "deployed", at: t(BASE + 2 * H) },
    { status: "failed", at: t(BASE + 3 * H) }, // recovered 4h later
    { status: "deployed", at: t(BASE + 7 * H) },
  ]);
  assert.equal(s.recoveryHours.count, 2);
  assert.equal(s.recoveryHours.median, 3, "(2 + 4) / 2 = 3");
});

test("summarizeDeployments: an unrecovered failure (no later success) is not counted in recovery", () => {
  const s = summarizeDeployments([
    { status: "deployed", at: t(BASE) },
    { status: "failed", at: t(BASE + H) }, // no later success
  ]);
  assert.equal(s.recoveryHours.count, 0);
  assert.equal(s.recoveryHours.median, null);
  assert.equal(s.changeFailureRate, 0.5);
});

test("summarizeDeployments: order-independent (input may be newest-first, as stored)", () => {
  const s = summarizeDeployments([
    { status: "deployed", at: t(BASE + 2 * H) },
    { status: "failed", at: t(BASE) },
  ]);
  assert.equal(s.recoveryHours.median, 2, "sorted internally by time");
  assert.equal(s.lastDeployAt, t(BASE + 2 * H));
});

test("summarizeDeployments: frequency = successful deploys/week over the span; a single deploy -> the count", () => {
  const s = summarizeDeployments([
    { status: "deployed", at: t(BASE) },
    { status: "deployed", at: t(BASE + 14 * D) },
  ]);
  assert.equal(s.deployFrequencyPerWeek, 1, "2 successes over 14 days = 1/week");
  assert.equal(summarizeDeployments([{ status: "deployed", at: t(BASE) }]).deployFrequencyPerWeek, 1, "zero span -> count");
});

test("summarizeDeployments: a rollback recovers a failure and is excluded from deploy counts (H1)", () => {
  const s = summarizeDeployments([
    { status: "deployed", at: t(BASE) },
    { status: "failed", at: t(BASE + H) }, // recovered by the rollback 0.5h later
    { status: "rolled_back", at: t(BASE + 1.5 * H) },
  ]);
  assert.equal(s.total, 2, "a rollback is not a deploy attempt");
  assert.equal(s.deployed, 1);
  assert.equal(s.failed, 1);
  assert.equal(s.changeFailureRate, 0.5);
  assert.equal(s.recoveryHours.count, 1, "the rollback IS the recovery");
  assert.equal(s.recoveryHours.median, 0.5);
});
