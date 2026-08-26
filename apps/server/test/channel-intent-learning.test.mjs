import test from "node:test";
import assert from "node:assert/strict";
import {
  buildChannelIntentReplayCases,
  channelIntentLearningSummary,
  recordChannelIntentLearningSample,
  redactChannelIntentText,
  resolveLatestChannelIntentLearningSample,
} from "../src/services/channel-intent-learning.mjs";

function harness() {
  const state = { channelIntentLearningSamples: [] };
  let sequence = 0;
  let clock = "2026-08-24T08:00:00.000Z";
  return {
    state,
    now: () => clock,
    nextId: (prefix) => `${prefix}_${++sequence}`,
    setNow: (value) => { clock = value; },
  };
}

test("困难意图样本只保留脱敏文本，不保留可猜测的原文摘要", () => {
  const h = harness();
  const raw = "看 https://example.com/private?a=1，邮箱 me@example.com，手机 13800138000，token=abcdef123456，文件 /Users/me/customer.xlsx";
  const result = recordChannelIntentLearningSample({
    ...h,
    channelId: "chn_1",
    conversationId: "conv_1",
    eventId: "evt_1",
    text: raw,
    reason: "low_confidence",
    prediction: { intent: "ambiguous", confidence: 0.2, source: "custom", reason: "must_not_persist" },
  });
  assert.equal(result.ok, true);
  const serialized = JSON.stringify(h.state.channelIntentLearningSamples);
  assert.doesNotMatch(serialized, /example\.com|me@example|13800138000|abcdef123456|Users\/me/);
  assert.match(result.sample.redactedText, /\[链接\].*\[邮箱\].*\[号码\].*\[敏感信息\].*\[本地路径\]/);
  assert.equal(Object.hasOwn(result.sample.prediction, "reason"), false);
  assert.equal(result.sample.textDigest.length, 64);
  assert.equal(result.sample.status, "pending_review");
});

test("重复困难表达合并计数，用户纠正后才成为可回放样本", () => {
  const h = harness();
  const input = { ...h, channelId: "chn_1", conversationId: "conv_1", text: "这个先处理一下", reason: "focus_missing" };
  recordChannelIntentLearningSample({ ...input, eventId: "evt_1" });
  h.setNow("2026-08-24T08:01:00.000Z");
  const duplicate = recordChannelIntentLearningSample({ ...input, eventId: "evt_2" });
  assert.equal(duplicate.deduplicated, true);
  assert.equal(h.state.channelIntentLearningSamples.length, 1);
  assert.equal(duplicate.sample.occurrenceCount, 2);
  assert.equal(buildChannelIntentReplayCases(h.state.channelIntentLearningSamples).length, 0);

  const resolved = resolveLatestChannelIntentLearningSample({
    state: h.state,
    now: h.now,
    conversationId: "conv_1",
    eventId: "evt_3",
    resolution: { intent: "task_control", controlKind: "pause", taskKind: "content_video", threadId: "must_not_persist" },
  });
  assert.equal(resolved.resolved, true);
  assert.deepEqual(resolved.sample.expected, { intent: "task_control", controlKind: "pause", taskKind: "content_video" });
  assert.equal(Object.hasOwn(resolved.sample.expected, "threadId"), false);
  assert.equal(buildChannelIntentReplayCases(h.state.channelIntentLearningSamples).length, 1);
  assert.deepEqual(channelIntentLearningSummary(h.state.channelIntentLearningSamples), {
    difficultSamples: 1,
    pendingReviewSamples: 0,
    resolvedCorrections: 1,
    replayReadySamples: 1,
    deduplicatedOccurrences: 1,
    byReason: { focus_missing: 1 },
    byDomain: { content: 1 },
    updatedAt: "2026-08-24T08:01:00.000Z",
  });
});

test("脱敏函数限制长度并处理 Windows 路径与 bearer 凭据", () => {
  const redacted = redactChannelIntentText(`Bearer abcdefghijklmnopqrstuvwxyz C:\\Users\\psy\\secret.txt ${"长".repeat(800)}`);
  assert.match(redacted, /^\[敏感信息\] \[本地路径\]/);
  assert.ok(redacted.length <= 500);
});

test("过期困难表达和空纠正不会污染可回放集合", () => {
  const h = harness();
  recordChannelIntentLearningSample({
    ...h,
    channelId: "chn_1",
    conversationId: "conv_1",
    text: "这个怎么办",
    reason: "focus_missing",
  });
  h.setNow("2026-08-24T09:00:01.000Z");
  assert.equal(resolveLatestChannelIntentLearningSample({
    state: h.state,
    now: h.now,
    conversationId: "conv_1",
    resolution: { intent: "task_control", taskKind: "content_article" },
  }).resolved, false);
  assert.equal(resolveLatestChannelIntentLearningSample({
    state: h.state,
    now: h.now,
    conversationId: "conv_1",
    resolution: {},
  }).reason, "invalid_resolution");
  assert.equal(h.state.channelIntentLearningSamples[0].status, "pending_review");
  assert.equal(buildChannelIntentReplayCases(h.state.channelIntentLearningSamples).length, 0);
});
