/*
 * ai:impact hooked into run-work: every apply builds the Change Impact & Risk
 * Assessment from the working-tree diff, writes it as evidence, folds it into the
 * PR body, and mirrors it onto the issue. These pin the two pure seams —
 * buildImpactAssessment (diff → markdown, with a fallback) and formatPrBody
 * (embeds the section) — without spinning a real adapter/PR.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildImpactAssessment,
  configureWorkRunnerContext,
  formatPrBody,
} from "../src/legacy/work-runner.mjs";

test("buildImpactAssessment renders the section from the working-tree diff", () => {
  const commandOutput = (_cmd, args) =>
    args.includes("--name-status") ? "M\tapps/server/src/services/agents.mjs" : ""; // no untracked
  const md = buildImpactAssessment({ commandOutput, scopeResult: null });
  assert.ok(md.startsWith("## Change Impact & Risk Assessment"));
  assert.ok(md.includes("apps/server/src/services/agents.mjs"));
  assert.ok(md.includes("Touches business flow: yes"));
});

test("buildImpactAssessment folds in untracked files as adds", () => {
  const commandOutput = (_cmd, args) =>
    args.includes("--others") ? "tools/ai/src/new.mjs" : ""; // untracked only, empty diff
  const md = buildImpactAssessment({ commandOutput, scopeResult: null });
  assert.ok(md.includes("`tools/ai/src/new.mjs` · add · source"));
});

test("buildImpactAssessment falls back to scope-check files when the diff is empty", () => {
  const commandOutput = () => ""; // adapter already committed → git diff HEAD empty
  const md = buildImpactAssessment({ commandOutput, scopeResult: { changedFiles: ["docs/x.md"] } });
  assert.ok(md.includes("`docs/x.md` · edit · docs"));
});

test("formatPrBody embeds the impact section and closes the issue", () => {
  configureWorkRunnerContext({ formatProductFlow: () => "- Role flow: not applicable" });
  const body = formatPrBody({
    issue: "42",
    plan: { prSummary: "do the thing", productFlow: {}, affectedSurfaces: [], prototypeStates: [], acceptanceSignals: [], visualQaTasks: [] },
    runId: "r1",
    adapter: { name: "mock" },
    verified: true,
    testPlan: { changes: ["docs"], risk: "low" },
    scopeResult: { allowed: true, driftLevel: "none" },
    impactMarkdown: "## Change Impact & Risk Assessment\n\n- Risk: low\n",
  });
  assert.ok(body.includes("## Change Impact & Risk Assessment"));
  assert.ok(body.includes("- Risk: low"));
  assert.ok(body.includes("Closes #42"));
});
