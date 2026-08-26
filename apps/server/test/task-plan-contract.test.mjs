import test from "node:test";
import assert from "node:assert/strict";
import { planDiscreteTasks } from "../src/services/discrete-task-planner.mjs";
import { validateTaskPlan } from "../src/services/task-plan-contract.mjs";

test("valid discrete plans receive a stable contract digest", () => {
  const plan = planDiscreteTasks({ text: "写一篇文章，同时做漫画和口播", domain: "content" });
  const result = validateTaskPlan(plan);
  assert.equal(result.ok, true);
  assert.equal(result.summary.version, 2);
  assert.match(result.summary.digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(result.summary.taskCount, 3);
  assert.equal(result.confidence, 0.95);
});

test("invalid plans fail closed for duplicate, dangling, cyclic, and unapproved external work", () => {
  const result = validateTaskPlan({
    tasks: [
      { key: "a", kind: "content_article", title: "文章", requires: ["missing"], intentId: "i", artifactContract: { produces: ["article_draft"] } },
      { key: "a", kind: "content_publish", title: "发布", requires: ["a"], intentId: "i", approvalRequired: false, gate: null, artifactContract: { produces: ["receipt"] } },
    ],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("duplicate_task_key"));
  assert.ok(result.errors.includes("dangling_dependency"));
  assert.ok(result.errors.includes("external_task_without_approval"));
});

test("mixed intent ids are rejected instead of merging unrelated work", () => {
  const result = validateTaskPlan({
    tasks: [
      { key: "a", kind: "content_article", title: "文章", requires: [], intentId: "i1", artifactContract: { produces: [] } },
      { key: "b", kind: "software_implementation", title: "开发", requires: [], intentId: "i2", artifactContract: { produces: [] } },
    ],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("mixed_intent_ids"));
});

test("hard dependencies must carry a real artifact handoff", () => {
  const result = validateTaskPlan({
    tasks: [
      { key: "article", kind: "content_article", title: "文章", requires: [], artifactContract: { consumes: [], produces: ["article_draft"] } },
      { key: "video", kind: "content_video", title: "视频", requires: ["article"], artifactContract: { consumes: ["coding_digest"], produces: ["video_package"] } },
    ],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("dependency_without_artifact_handoff"));
});

test("contract digest changes when task dependencies change", () => {
  const independent = planDiscreteTasks({ text: "写文章和图片", domain: "content" });
  const dependent = planDiscreteTasks({ text: "写文章并为文章配图", domain: "content" });
  assert.notEqual(validateTaskPlan(independent).summary.digest, validateTaskPlan(dependent).summary.digest);
});
