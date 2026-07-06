/*
 * The issue decision step (slice 1): contract validation, heuristic floor, and
 * the confidence gates that keep low-confidence agent decisions off the heavy
 * paths. Pure logic, no I/O.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  decisionConfig,
  heuristicDecision,
  intentForPath,
  normalizeDecision,
  resolveDecision,
} from "../src/services/auto-run-decision.mjs";

test("heuristicDecision maps today's intents onto the contract", () => {
  assert.equal(heuristicDecision({ title: "Fix the crash" }).path, "develop");
  assert.equal(heuristicDecision({ title: "Investigate flaky CI" }).path, "design");
  assert.equal(heuristicDecision({ title: "Should we adopt Postgres?" }).path, "clarify");
  const d = heuristicDecision({ title: "Fix it" });
  assert.equal(d.decidedBy, "heuristic");
  assert.equal(d.spawnChildIssues, false);
  assert.ok(d.confidence > 0 && d.confidence < 1);
});

test("intentForPath derives the legacy intent field", () => {
  assert.equal(intentForPath("develop"), "change");
  assert.equal(intentForPath("design"), "investigation");
  assert.equal(intentForPath("prototype"), "investigation");
  assert.equal(intentForPath("clarify"), "question");
  assert.equal(intentForPath("bogus"), "change");
});

test("normalizeDecision validates the contract and clamps values", () => {
  assert.equal(normalizeDecision(null), null);
  assert.equal(normalizeDecision({ path: "world-domination" }), null, "unknown path rejected");
  const d = normalizeDecision({
    path: "design",
    confidence: 7,
    rationale: "r",
    spawnChildIssues: "yes",
    clarifyingQuestions: ["ok", 42, "  ", "also ok"],
  });
  assert.equal(d.confidence, 1, "confidence clamped to [0,1]");
  assert.equal(d.spawnChildIssues, false, "only boolean true spawns");
  assert.deepEqual(d.clarifyingQuestions, ["ok", "also ok"]);
  assert.equal(d.decidedBy, "agent");
});

test("resolveDecision: no decider -> heuristic; broken/invalid decider -> heuristic", async () => {
  const link = { title: "Fix the crash" };
  assert.equal((await resolveDecision({ link })).decidedBy, "heuristic");
  assert.equal((await resolveDecision({ link, decideIssuePath: async () => { throw new Error("x"); } })).decidedBy, "heuristic");
  assert.equal((await resolveDecision({ link, decideIssuePath: async () => ({ path: "nope" }) })).decidedBy, "heuristic");
});

test("resolveDecision: confidence gate degrades heavy paths, not develop/clarify", async () => {
  const low = (path, extra = {}) => ({ path, confidence: 0.2, rationale: "r", ...extra });
  const design = await resolveDecision({ link: {}, decideIssuePath: async () => low("design"), minConfidence: 0.6 });
  assert.equal(design.path, "clarify");
  assert.match(design.rationale, /Degraded to clarify/);

  const spawny = await resolveDecision({ link: {}, decideIssuePath: async () => low("develop", { spawnChildIssues: true }), minConfidence: 0.6 });
  assert.equal(spawny.path, "clarify", "low-confidence spawning also degrades");
  assert.equal(spawny.spawnChildIssues, false);

  const develop = await resolveDecision({ link: {}, decideIssuePath: async () => low("develop"), minConfidence: 0.6 });
  assert.equal(develop.path, "develop", "a light path passes at low confidence");

  const confident = await resolveDecision({ link: {}, decideIssuePath: async () => ({ path: "design", confidence: 0.9, rationale: "r" }), minConfidence: 0.6 });
  assert.equal(confident.path, "design", "a confident heavy decision passes");
});

test("decisionConfig reads the env threshold and defaults to 0.6", () => {
  assert.equal(decisionConfig({}).minConfidence, 0.6);
  assert.equal(decisionConfig({ MYAGENTTOOL_AUTORUN_DECISION_MIN_CONFIDENCE: "0.8" }).minConfidence, 0.8);
  assert.equal(decisionConfig({ MYAGENTTOOL_AUTORUN_DECISION_MIN_CONFIDENCE: "junk" }).minConfidence, 0.6);
});
