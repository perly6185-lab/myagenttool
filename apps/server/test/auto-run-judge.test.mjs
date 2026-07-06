/*
 * The acceptance judge (Phase B): config, verdict normalization, the command
 * round-trip (real subprocess), and the PR-body evidence lines.
 */

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { judgeTimeoutMs, judgmentEvidence, normalizeJudgment, resolveJudgeCommand, runAcceptanceJudge } from "../src/services/auto-run-judge.mjs";

test("resolveJudgeCommand parses env argv; junk/absent -> null", () => {
  assert.equal(resolveJudgeCommand({}), null);
  assert.deepEqual(resolveJudgeCommand({ MYAGENTTOOL_AUTORUN_JUDGE_COMMAND_JSON: '["node","judge.mjs"]' }), ["node", "judge.mjs"]);
  assert.equal(resolveJudgeCommand({ MYAGENTTOOL_AUTORUN_JUDGE_COMMAND_JSON: "junk" }), null);
});

test("judgeTimeoutMs clamps; defaults 120s", () => {
  assert.equal(judgeTimeoutMs({}), 120_000);
  assert.equal(judgeTimeoutMs({ MYAGENTTOOL_AUTORUN_JUDGE_TIMEOUT_MS: "5000" }), 5000);
  assert.equal(judgeTimeoutMs({ MYAGENTTOOL_AUTORUN_JUDGE_TIMEOUT_MS: "1" }), 120_000);
});

test("normalizeJudgment: solved must be boolean; confidence clamped; gaps filtered", () => {
  assert.equal(normalizeJudgment(null), null);
  assert.equal(normalizeJudgment({ solved: "yes" }), null);
  const j = normalizeJudgment({ solved: false, confidence: 9, summary: "s", gaps: ["a", 3, " ", "b"] });
  assert.equal(j.solved, false);
  assert.equal(j.confidence, 1);
  assert.deepEqual(j.gaps, ["a", "b"]);
});

test("runAcceptanceJudge round-trips the issue + diff and caps the diff", async () => {
  const dir = mkdtempSync(join(tmpdir(), "judge-"));
  const judge = join(dir, "judge.mjs");
  writeFileSync(judge, [
    'let raw = ""; process.stdin.on("data", (c) => (raw += c));',
    'process.stdin.on("end", () => {',
    "  const ctx = JSON.parse(raw);",
    "  process.stdout.write(JSON.stringify({ solved: ctx.diff.includes('name'), confidence: 0.9, summary: `judged #${ctx.link.number}`, gaps: [] }));",
    "});",
  ].join("\n"));
  const verdict = await runAcceptanceJudge({
    command: ["node", judge],
    link: { type: "issue", number: 7, title: "Add name param" },
    issueBody: "## Acceptance\n- name param",
    diff: "+ String name;\n".repeat(10_000), // oversized → capped, still contains "name"
  });
  assert.equal(verdict.solved, true);
  assert.match(verdict.summary, /judged #7/);
});

test("judgmentEvidence renders skipped / errored / solved / not-solved lines", () => {
  assert.match(judgmentEvidence(undefined), /not run/);
  assert.match(judgmentEvidence(null), /judge errored/);
  assert.match(judgmentEvidence({ solved: true, confidence: 0.9, summary: "ok", gaps: [] }), /solved \(confidence 90%\)/);
  const bad = judgmentEvidence({ solved: false, confidence: 0.8, summary: "missing test", gaps: ["no test for the no-name case"] });
  assert.match(bad, /NOT solved/);
  assert.match(bad, /gap: no test for the no-name case/);
});
