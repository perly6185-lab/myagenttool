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
  isEpicIssue,
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
  assert.equal(decisionConfig({}).fastPath, true, "fast path defaults on");
  assert.equal(decisionConfig({ MYAGENTTOOL_AUTORUN_DECIDER_FAST_PATH: "0" }).fastPath, false);
});

test("fast path: a strong lexical signal skips the decider entirely", async () => {
  let called = 0;
  const decideIssuePath = async () => {
    called += 1;
    return { path: "develop", confidence: 0.9, rationale: "r" };
  };
  const q = await resolveDecision({ link: { title: "Should we adopt Postgres?" }, decideIssuePath, fastPath: true });
  assert.equal(q.path, "clarify");
  assert.equal(q.via, "fast-path");
  assert.equal(called, 0, "question title never pays the decider hop");

  const inv = await resolveDecision({ link: { title: "Investigate flaky CI" }, decideIssuePath, fastPath: true });
  assert.equal(inv.path, "design");
  assert.equal(inv.via, "fast-path");
  assert.equal(called, 0);

  // The weak "change" default is exactly where ambiguity lives — decider runs.
  const change = await resolveDecision({ link: { title: "Add caching" }, decideIssuePath, fastPath: true });
  assert.equal(called, 1, "ambiguous title pays the hop");
  assert.equal(change.via, "agent");
  assert.equal(typeof change.latencyMs, "number", "agent decisions carry latency");
});

test("fast path off: even strong signals go to the decider", async () => {
  let called = 0;
  const decideIssuePath = async () => {
    called += 1;
    return { path: "design", confidence: 0.9, rationale: "r" };
  };
  const d = await resolveDecision({ link: { title: "Should we adopt Postgres?" }, decideIssuePath, fastPath: false });
  assert.equal(called, 1);
  assert.equal(d.via, "agent");
});

test("a failed decider records via=fallback with the heuristic result", async () => {
  const d = await resolveDecision({
    link: { title: "Add caching" },
    decideIssuePath: async () => {
      throw new Error("boom");
    },
    fastPath: false,
  });
  assert.equal(d.decidedBy, "heuristic");
  assert.equal(d.via, "fallback");
  assert.equal(typeof d.latencyMs, "number");
});

test("isEpicIssue detects epics by title prefix or Project-Fields type", () => {
  assert.equal(isEpicIssue({ link: { title: "[Epic]: Ship the console" } }), true);
  assert.equal(isEpicIssue({ link: { title: "[Initiative]: Payments" } }), true);
  assert.equal(isEpicIssue({ link: { title: "Add a widget" }, issueBody: "## Project Fields\nType: epic\n" }), true);
  assert.equal(isEpicIssue({ link: { title: "Add a widget" }, issueBody: "Type: initiative" }), true);
  assert.equal(isEpicIssue({ link: { title: "Fix the crash" }, issueBody: "Type: task" }), false);
  assert.equal(isEpicIssue({ link: { title: "Fix the crash" } }), false);
});

test("resolveDecision routes an epic to decompose ONLY when epicDecomposition is on", async () => {
  const link = { title: "[Epic]: Ship the console", number: 5 };
  // off (default): epics are not special — a develop-shaped epic routes as before
  const off = await resolveDecision({ link, decideIssuePath: undefined });
  assert.notEqual(off.path, "decompose");
  // on: deterministic decompose, no decider hop
  const on = await resolveDecision({ link, decideIssuePath: async () => ({ path: "develop", confidence: 0.9 }), epicDecomposition: true });
  assert.equal(on.path, "decompose");
  assert.equal(on.via, "epic-detector");
  assert.equal(on.spawnChildIssues, true);
  // a non-epic issue is unaffected even when the flag is on
  const normal = await resolveDecision({ link: { title: "Fix the crash", number: 6 }, decideIssuePath: undefined, epicDecomposition: true });
  assert.notEqual(normal.path, "decompose");
});

test("normalizeDecision accepts an agent-returned decompose path", () => {
  assert.equal(normalizeDecision({ path: "decompose", confidence: 0.9 })?.path, "decompose");
});
