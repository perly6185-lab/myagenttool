import { test } from "node:test";
import assert from "node:assert/strict";
import { decompositionChildBody, projectFieldsBlockFromFields, isSpawnedChildBody } from "../src/services/auto-run-spawn.mjs";

test("projectFieldsBlockFromFields renders a governance block, forcing Status: backlog", () => {
  const block = projectFieldsBlockFromFields({ milestone: "M2", area: "server", type: "task", risk: "low", acceptance: "defined", platform: "all", agentTarget: "platform", priority: "p2", sourceDoc: "docs/x.md" });
  assert.match(block, /## Project Fields/);
  assert.match(block, /Milestone: M2/);
  assert.match(block, /Status: backlog/);
  assert.match(block, /Agent: platform/);
  assert.match(block, /Source Doc: docs\/x.md/);
});

test("decompositionChildBody carries the depth-1 marker, acceptance checklist, and fields", () => {
  const body = decompositionChildBody({
    parentLink: { number: 42 },
    spec: { title: "[Task]: Part A", problem: "Do A", userStory: "As a user I can A", acceptanceCriteria: ["A works", "A tested"], projectFields: { milestone: "M2", area: "server", type: "task", risk: "low", platform: "all", priority: "p2" } },
  });
  assert.match(body, /Spawned from epic #42/);
  assert.match(body, /myagent:autorun:child-of:#42/);
  assert.ok(isSpawnedChildBody(body), "the child is depth-1 marked (cannot spawn grandchildren)");
  assert.match(body, /## Problem\n\nDo A/);
  assert.match(body, /- \[ \] A works/);
  assert.match(body, /- \[ \] A tested/);
  assert.match(body, /## Project Fields/);
  assert.match(body, /label this issue `auto`/, "still requires a human to start the child");
});

test("decompositionChildBody tolerates a sparse spec (no user story / no acceptance)", () => {
  const body = decompositionChildBody({ parentLink: { number: 7 }, spec: { title: "[Task]: Bare", projectFields: {} } });
  assert.ok(!body.includes("## User Story"), "omits an empty user story");
  assert.match(body, /- \[ \] TODO/, "falls back to a TODO acceptance item");
});
