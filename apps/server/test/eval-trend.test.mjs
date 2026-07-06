/*
 * Eval-trend observability: reads #248's local trend.jsonl and summarizes it for
 * the product panel. Pure summarizer + best-effort reader — never throws, infra
 * failures never count as capability regressions.
 */

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { PROVISIONAL_FLOORS, readEvalTrend, summarizeEvalTrend } from "../src/services/eval-trend.mjs";

const subcap = (startedAt, passRate, resolved, total) => ({
  startedAt,
  claude: "2.1.198 (Claude Code)",
  kind: "subcap-only",
  subcap: { passRate, resolved, total, byKind: {} },
});

const authFail = (startedAt) => ({
  startedAt,
  kind: "subcap-only",
  authFailure: true,
  authDetail: "claude CLI is not logged in (cron session lacks the login)",
  infraFailure: true,
});

test("empty input: zero totals, null latest, nothing regressed", () => {
  const s = summarizeEvalTrend([]);
  assert.equal(s.total, 0);
  assert.equal(s.subcap.latest, null);
  assert.equal(s.subcap.regressed, false, "no data is not a regression");
  assert.equal(s.subcap.realRuns, 0);
  assert.equal(s.lastRunAt, null);
});

test("latest/previous/delta track chronological (oldest-first) subcap points", () => {
  const s = summarizeEvalTrend([
    subcap("2026-07-02T18:30:00Z", 0.4, 6, 15),
    subcap("2026-07-06T06:34:00Z", 1, 15, 15),
  ]);
  assert.equal(s.subcap.realRuns, 2);
  assert.equal(s.subcap.latest.passRate, 1);
  assert.equal(s.subcap.previous.passRate, 0.4);
  assert.equal(s.subcap.delta, 0.6, "latest minus previous");
  assert.equal(s.subcap.latest.resolved, 15);
});

test("infra/auth failures never produce a metric point and never regress", () => {
  const s = summarizeEvalTrend([
    subcap("2026-07-02T18:30:00Z", 1, 15, 15),
    authFail("2026-07-03T18:30:00Z"),
    authFail("2026-07-04T18:30:00Z"),
  ]);
  assert.equal(s.subcap.realRuns, 1, "auth-failed rows are excluded from the series");
  assert.equal(s.subcap.latest.passRate, 1, "latest real point, not the failure");
  assert.equal(s.subcap.regressed, false);
  assert.equal(s.infraFailures, 2);
  assert.equal(s.lastInfraFailure.startedAt, "2026-07-04T18:30:00Z");
  assert.match(s.lastInfraFailure.detail, /not logged in/);
  assert.equal(s.lastRunAt, "2026-07-04T18:30:00Z", "lastRunAt is any last record, incl. failures");
});

test("a real score below the provisional floor is flagged as regressed", () => {
  const below = PROVISIONAL_FLOORS.subcap - 0.2;
  const s = summarizeEvalTrend([subcap("2026-07-02T18:30:00Z", below, 3, 15)]);
  assert.equal(s.subcap.regressed, true);
  assert.equal(s.subcap.floorProvisional, true, "floor is labelled provisional until #250 sets it");
});

test("enoughForLines gates on >=3 real runs (the #250 acceptance bar)", () => {
  const two = summarizeEvalTrend([
    subcap("2026-07-02T00:00:00Z", 1, 15, 15),
    subcap("2026-07-03T00:00:00Z", 1, 15, 15),
  ]);
  assert.equal(two.subcap.enoughForLines, false);
  assert.equal(two.minRunsForLines, 3);
  const three = summarizeEvalTrend([
    subcap("2026-07-02T00:00:00Z", 1, 15, 15),
    subcap("2026-07-03T00:00:00Z", 1, 15, 15),
    subcap("2026-07-04T00:00:00Z", 1, 15, 15),
  ]);
  assert.equal(three.subcap.enoughForLines, true);
});

test("held-out {skipped: 'repo dirty'} is not a real point", () => {
  const s = summarizeEvalTrend([
    { startedAt: "2026-07-04T19:30:00Z", kind: "full", subcap: { passRate: 1, resolved: 15, total: 15 }, heldout: { skipped: "repo dirty" } },
  ]);
  assert.equal(s.heldout.realRuns, 0, "a skipped held-out block yields no metric point");
  assert.equal(s.heldout.latest, null);
  assert.equal(s.subcap.realRuns, 1);
});

test("readEvalTrend: missing file → [], garbage lines skipped", () => {
  assert.deepEqual(readEvalTrend({ trendFile: "/no/such/trend.jsonl" }), []);
  const dir = mkdtempSync(join(tmpdir(), "eval-trend-"));
  const file = join(dir, "trend.jsonl");
  writeFileSync(file, `${JSON.stringify(subcap("2026-07-06T06:34:00Z", 1, 15, 15))}\nnot json\n\n`);
  const records = readEvalTrend({ trendFile: file });
  assert.equal(records.length, 1, "the one valid line parses; blank + garbage dropped");
  assert.equal(records[0].subcap.passRate, 1);
});
