import assert from "node:assert/strict";
import { test } from "node:test";

import {
  beginChannelExecutionAttempt,
  finishChannelExecutionAttempt,
  freezeChannelExecutionContract,
} from "../src/services/channel-execution-contract.mjs";

test("channel execution contract is stable and bounded to the confirmed identity", () => {
  const input = {
    thread: {
      id: "cth_1",
      taskKind: "content_publish",
      intentId: "intent_1",
      intentStatement: "把文章发布到公众号",
      workGoalId: "goal_1",
      summary: "发布文章",
      riskPreviewDigest: "preview_1",
      dependencyIds: ["wi_b", "wi_a", "wi_a"],
      platformTarget: { id: "wechat_official", label: "公众号" },
    },
    resultData: { workItemId: "wi_1", previewDigest: "preview_1" },
    confirmedByEventId: "evt_1",
    confirmedAt: "2026-08-24T00:00:00.000Z",
    idempotencyKey: "channel-route:ctr_1",
  };
  const first = freezeChannelExecutionContract(input);
  const second = freezeChannelExecutionContract({ ...input, resultData: { ...input.resultData, ignored: "large result body" } });

  assert.equal(first.schemaVersion, 1);
  assert.equal(first.digest, second.digest);
  assert.deepEqual(first.snapshot.dependencyIds, ["wi_a", "wi_b"]);
  assert.equal(first.snapshot.workItemId, "wi_1");
  assert.equal(first.snapshot.platformId, "wechat_official");
});
test("channel execution attempts increment and preserve the failure boundary", () => {
  const started = beginChannelExecutionAttempt(null, { operationKey: "op_1", startedAt: "t1" });
  const failed = finishChannelExecutionAttempt(started, { outcome: "failed", finishedAt: "t2", error: "temporary" });
  const retried = beginChannelExecutionAttempt(failed, { operationKey: "op_1", startedAt: "t3" });

  assert.equal(failed.count, 1);
  assert.equal(failed.outcome, "failed");
  assert.equal(retried.count, 2);
  assert.equal(retried.operationKey, "op_1");
  assert.equal(retried.outcome, "started");
});
