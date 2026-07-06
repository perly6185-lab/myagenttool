/*
 * Governed child-issue spawning (slice 4): the pending-decision child body
 * (depth-1 marker, inherited Project Fields, human gate), title, config gate,
 * and the gh create runner. Pure logic + fake gh.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  childIssueBody,
  childIssueTitle,
  extractProjectFieldsBlock,
  isSpawnedChildBody,
  runChildIssueCreate,
  spawnIssuesConfig,
} from "../src/services/auto-run-spawn.mjs";

test("spawnIssuesConfig is off unless explicitly enabled", () => {
  assert.equal(spawnIssuesConfig({}).enabled, false);
  assert.equal(spawnIssuesConfig({ MYAGENTTOOL_AUTORUN_SPAWN_ISSUES: "1" }).enabled, true);
  assert.equal(spawnIssuesConfig({ MYAGENTTOOL_AUTORUN_SPAWN_ISSUES: "true" }).enabled, true);
});

test("extractProjectFieldsBlock lifts the parent's block, verbatim, or null", () => {
  const body = "Intro\n\n## Project Fields\n\nMilestone: M3\nStatus: ready\nArea: server\n\n## Other\nx";
  const block = extractProjectFieldsBlock(body);
  assert.match(block, /^## Project Fields/);
  assert.match(block, /Milestone: M3/);
  assert.match(block, /Area: server/);
  assert.ok(!block.includes("## Other"));
  assert.equal(extractProjectFieldsBlock("no fields here"), null);
});

test("childIssueBody: human gate, depth-1 marker, design, acceptance, inherited fields with backlog status", () => {
  const body = childIssueBody({
    parentLink: { number: 42, title: "Rework the queue" },
    design: "Use Redis streams. Acceptance: consumer lag < 1s.",
    projectFieldsBlock: "## Project Fields\n\nMilestone: M3\nStatus: ready\nArea: server",
  });
  assert.match(body, /A human must review this design/);
  assert.match(body, /<!-- myagent:autorun:child-of:#42 -->/);
  assert.match(body, /## Design\n\nUse Redis streams/);
  assert.match(body, /## Acceptance/);
  assert.match(body, /Status: backlog/, "status forced back to backlog");
  assert.ok(!body.match(/Status: ready/), "parent's ready status not inherited");
  assert.ok(isSpawnedChildBody(body), "the body identifies itself as a child (depth 1)");
});

test("childIssueBody without parent fields flags the triage need instead of inventing fields", () => {
  const body = childIssueBody({ parentLink: { number: 7, title: "X" }, design: "d", projectFieldsBlock: null });
  assert.match(body, /need human triage/);
  assert.ok(!body.includes("## Project Fields"), "no fabricated fields block");
});

test("childIssueTitle derives from the parent and caps length", () => {
  assert.equal(childIssueTitle({ number: 5, title: "Rework the queue" }), "Implement: Rework the queue");
  assert.ok(childIssueTitle({ number: 5, title: "x".repeat(300) }).length <= 120);
});

test("runChildIssueCreate parses the created issue url; missing url throws", async () => {
  const calls = [];
  const gh = async (args, cwd) => {
    calls.push({ args, cwd });
    return { stdout: "https://github.com/o/r/issues/99\n" };
  };
  const child = await runChildIssueCreate({ cwd: "/repo", title: "T", body: "B", gh });
  assert.deepEqual(child, { number: 99, url: "https://github.com/o/r/issues/99" });
  assert.deepEqual(calls[0].args.slice(0, 3), ["issue", "create", "--title"]);

  await assert.rejects(
    () => runChildIssueCreate({ cwd: "/repo", title: "T", body: "B", gh: async () => ({ stdout: "no url" }) }),
    /no issue url/,
  );
});
