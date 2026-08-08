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
    taskUnderstanding: "  Deliver an observable result.  ",
    acceptanceCriteria: ["Result is visible", 42, ""],
    verificationSop: ["Run the focused test"],
    risks: ["Compatibility behavior may change"],
  });
  assert.equal(d.confidence, 1, "confidence clamped to [0,1]");
  assert.equal(d.spawnChildIssues, false, "only boolean true spawns");
  assert.deepEqual(d.clarifyingQuestions, ["ok", "also ok"]);
  assert.equal(d.taskUnderstanding, "Deliver an observable result.");
  assert.deepEqual(d.acceptanceCriteria, ["Result is visible"]);
  assert.deepEqual(d.verificationSop, ["Run the focused test"]);
  assert.deepEqual(d.risks, ["Compatibility behavior may change"]);
  assert.equal(d.decidedBy, "agent");
});

test("resolveDecision: no decider -> heuristic; broken/invalid decider -> heuristic", async () => {
  const link = { title: "Fix the crash" };
  assert.equal((await resolveDecision({ link })).decidedBy, "heuristic");
  assert.equal((await resolveDecision({ link, decideIssuePath: async () => { throw new Error("x"); } })).decidedBy, "heuristic");
  assert.equal((await resolveDecision({ link, decideIssuePath: async () => ({ path: "nope" }) })).decidedBy, "heuristic");
});

test("resolveDecision: records stable, versioned routing evidence", async () => {
  const input = { link: { title: "Implement retries" }, issueBody: "Add bounded retry handling." };
  const first = await resolveDecision(input);
  const second = await resolveDecision(input);
  const changed = await resolveDecision({ ...input, issueBody: "Add cancellation handling." });
  assert.match(first.evidence.policyVersion, /^2026-/);
  assert.equal(first.evidence.inputDigest, second.evidence.inputDigest);
  assert.notEqual(first.evidence.inputDigest, changed.evidence.inputDigest);
  assert.equal(first.evidence.inputDigest.length, 64);
});

test("resolveDecision passes bounded project context to the decider and fingerprints it", async () => {
  const seen = [];
  const decideIssuePath = async (input) => {
    seen.push(input);
    return { path: "develop", confidence: 0.9, rationale: "Project evidence supports implementation." };
  };
  const projectContext = {
    digest: "context-a",
    documents: [{ path: "README.md", excerpt: "Scheduling uses the terminal timezone." }],
    relatedFiles: [{ path: "src/schedule.mjs", line: 12, preview: "computeLocalSchedulePreview" }],
  };
  const first = await resolveDecision({
    link: { title: "Implement timezone propagation" },
    issueBody: "Update scheduling.",
    projectContext,
    decideIssuePath,
    fastPath: false,
  });
  const changed = await resolveDecision({
    link: { title: "Implement timezone propagation" },
    issueBody: "Update scheduling.",
    projectContext: { ...projectContext, digest: "context-b" },
    decideIssuePath,
    fastPath: false,
  });

  assert.equal(seen[0].projectContext, projectContext);
  assert.notEqual(first.evidence.inputDigest, changed.evidence.inputDigest);
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

test("resolveDecision: a low-confidence develop with open questions degrades to clarify (#5)", async () => {
  const withQ = await resolveDecision({
    link: {},
    decideIssuePath: async () => ({ path: "develop", confidence: 0.3, rationale: "unsure", clarifyingQuestions: ["Which endpoint?"] }),
    minConfidence: 0.6,
  });
  assert.equal(withQ.path, "clarify", "agent flagged questions + low confidence -> ask first, don't guess");
  assert.match(withQ.rationale, /develop confidence 0\.30 below 0\.6 with open questions/);
  assert.deepEqual(withQ.clarifyingQuestions, ["Which endpoint?"], "the questions survive to the clarify run");

  const noQ = await resolveDecision({
    link: {},
    decideIssuePath: async () => ({ path: "develop", confidence: 0.3, rationale: "r", clarifyingQuestions: [] }),
    minConfidence: 0.6,
  });
  assert.equal(noQ.path, "develop", "a quiet low-confidence develop still proceeds — a human reviews the diff");

  const confidentQ = await resolveDecision({
    link: {},
    decideIssuePath: async () => ({ path: "develop", confidence: 0.9, rationale: "r", clarifyingQuestions: ["a nit?"] }),
    minConfidence: 0.6,
  });
  assert.equal(confidentQ.path, "develop", "a confident develop proceeds even with a stray question");
});

test("resolveDecision: the heuristic fallback reads the body, guarded against change titles (#4)", async () => {
  // No decider -> the heuristic floor. A NEUTRAL title + investigation body -> design.
  const neutral = await resolveDecision({ link: { title: "Queue backend" }, issueBody: "Let's evaluate a few options." });
  assert.equal(neutral.path, "design");
  assert.equal(neutral.decidedBy, "heuristic");
  // A CHANGE-shaped title is never flipped by the body — the false-positive guard.
  const change = await resolveDecision({ link: { title: "Add a token bucket" }, issueBody: "First analyze traffic, then add it." });
  assert.equal(change.path, "develop");
  // The fast path stays title-only: a body-only signal does NOT short-circuit; it
  // pays the decider (a body mention is weaker than a title signal).
  let called = 0;
  const decider = async () => { called += 1; return { path: "develop", confidence: 0.9, rationale: "r" }; };
  const paid = await resolveDecision({ link: { title: "Queue backend" }, issueBody: "explore options", decideIssuePath: decider, fastPath: true });
  assert.equal(called, 1, "a body-only signal does not fast-path; the decider runs");
  assert.equal(paid.via, "agent");
});

test("resolveDecision: a transient decider failure falls back TITLE-ONLY (routing stays deterministic)", async () => {
  // A noun-phrase change title (not an imperative verb, so CHANGE_LEAD_RE misses)
  // with an investigation word in the body — the exact shape that used to flip.
  const link = { title: "Rate limiter for the reports API" };
  const issueBody = "We should evaluate token-bucket vs sliding-window before we build it.";
  const ok = await resolveDecision({ link, issueBody, decideIssuePath: async () => ({ path: "develop", confidence: 0.8, rationale: "r" }), fastPath: false });
  assert.equal(ok.path, "develop", "when the decider answers, it's a develop");
  // A transient decider failure must NOT change the deliverable type: title-only
  // fallback -> change -> develop, not body-aware -> design -> no code.
  const failed = await resolveDecision({ link, issueBody, decideIssuePath: async () => { throw new Error("timeout"); }, fastPath: false });
  assert.equal(failed.path, "develop", "a decider hiccup doesn't silently turn a change into a no-code design run");
  assert.equal(failed.via, "fallback");
  // The no-decider deployment still reads the body (deterministic for that config).
  const noDecider = await resolveDecision({ link, issueBody });
  assert.equal(noDecider.path, "design", "with no decider configured, the body-aware heuristic still routes to design");
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

test("resolveDecision does NOT re-decompose a spawned child even with an [Epic] title (depth-1 gate)", async () => {
  const childBody = "Spawned from epic #5.\n<!-- myagent:autorun:child-of:#5 -->\n## Problem\nx";
  const d = await resolveDecision({ link: { title: "[Epic]: Phase 2", number: 9 }, issueBody: childBody, decideIssuePath: undefined, epicDecomposition: true });
  assert.notEqual(d.path, "decompose", "a depth-1 child never re-decomposes into grandchildren");
  // a NON-child [Epic] with the flag on still decomposes
  const e = await resolveDecision({ link: { title: "[Epic]: Real", number: 10 }, issueBody: "## Project Fields\nType: epic", decideIssuePath: undefined, epicDecomposition: true });
  assert.equal(e.path, "decompose");
});
