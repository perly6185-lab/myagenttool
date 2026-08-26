import assert from "node:assert/strict";
import test from "node:test";

import { evaluateChannelIntentReplayCases } from "../src/services/channel-intent-replay-evaluation.mjs";

test("Channel replay evaluates exact discrete task boundaries and clarification", () => {
  const evaluation = evaluateChannelIntentReplayCases([
    {
      id: "content_parallel",
      text: "基于资料写篇文章，再做三张图片",
      expected: { taskKinds: ["content_article", "content_image"] },
    },
    {
      id: "publication_mapping",
      text: "做文章和图片，发公众号和小红书",
      expected: {
        taskKinds: ["content_article", "content_image"],
        clarificationKind: "publication_content_mapping",
      },
    },
    {
      id: "greeting",
      text: "你好",
      expected: { taskKinds: [] },
    },
  ]);
  assert.equal(evaluation.evaluated, 3);
  assert.equal(evaluation.passed, 3);
  assert.equal(evaluation.metrics.taskBoundaryAccuracy, 1);
  assert.equal(evaluation.metrics.unintendedTaskRate, 0);
  assert.equal(evaluation.metrics.clarificationAccuracy, 1);
});
test("Channel replay keeps non-task reviewed corrections visible but out of task-boundary scoring", () => {
  const evaluation = evaluateChannelIntentReplayCases([{
    id: "pause_control",
    text: "这个先停一下",
    expected: { intent: "task_control", controlKind: "pause" },
  }]);
  assert.equal(evaluation.evaluated, 0);
  assert.equal(evaluation.skipped, 1);
  assert.equal(evaluation.results[0].reason, "task_boundary_not_reviewed");
});

test("Channel replay preserves multiple instances of the same professional task kind", () => {
  const evaluation = evaluateChannelIntentReplayCases([{
    id: "two_translation_jobs",
    text: "把中文和日文两份手册分别翻译成英文",
    expected: { taskKinds: ["document_translation", "document_translation"] },
  }]);
  assert.equal(evaluation.passed, 1);
  assert.deepEqual(evaluation.results[0].actualKinds, ["document_translation", "document_translation"]);
});
