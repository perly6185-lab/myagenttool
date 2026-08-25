import assert from "node:assert/strict";
import test from "node:test";

import { isTechnicalCompletionSummary, mergeCodexCliResult } from "../src/codex-cli-result.mjs";

test("turn completion telemetry does not overwrite the latest Codex answer", () => {
  const answer = {
    summary: "这篇文章建议把频道输入与任务上下文分开处理。",
    touchedUserFiles: false,
    output: { latestMessage: "这篇文章建议把频道输入与任务上下文分开处理。" },
    cost: { model: "codex", billable: true, unknown: true },
  };
  const completion = {
    summary: "Codex CLI completed.",
    touchedUserFiles: true,
    output: { usage: { input_tokens: 30, output_tokens: 12 } },
    cost: { model: "codex", billable: true, unknown: true, inputTokens: 30, outputTokens: 12 },
  };

  const merged = mergeCodexCliResult(answer, completion);

  assert.equal(merged.summary, answer.summary);
  assert.equal(merged.output.latestMessage, answer.output.latestMessage);
  assert.deepEqual(merged.output.usage, completion.output.usage);
  assert.equal(merged.touchedUserFiles, true);
  assert.equal(merged.cost.inputTokens, 30);
});

test("a later substantive Codex answer still replaces an earlier answer", () => {
  const merged = mergeCodexCliResult(
    { summary: "第一版", output: { latestMessage: "第一版", usage: { input_tokens: 2 } } },
    { summary: "第二版", output: { latestMessage: "第二版" } },
  );

  assert.equal(merged.summary, "第二版");
  assert.equal(merged.output.latestMessage, "第二版");
  assert.deepEqual(merged.output.usage, { input_tokens: 2 });
});

test("technical completion summaries are recognized narrowly", () => {
  assert.equal(isTechnicalCompletionSummary("Codex CLI completed."), true);
  assert.equal(isTechnicalCompletionSummary("Codex app-server turn completed."), true);
  assert.equal(isTechnicalCompletionSummary("已完成文章分析，并整理出三点建议。"), false);
});
