import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeAutoRunSlos, DEFAULT_SLO_TARGETS } from "../src/services/auto-run-slo.mjs";

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
