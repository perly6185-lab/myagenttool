import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createServerRuntimeServices } from "../src/runtime/service-composer.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";

const NOW = "2026-08-14T00:00:00.000Z";
const OWNER = { userId: "usr_local", teamId: "team_local", role: "owner", authenticated: true };

test("dismissing a channel task sends a plain-language reply with thread correlation", async () => {
  const projectPath = mkdtempSync(join(tmpdir(), "channel-task-lifecycle-"));
  try {
    const { state, defaultProject } = createServerState({ defaultProjectPath: projectPath, now: () => NOW });
    const { httpDependencies: deps } = createServerRuntimeServices({
      namespace: "test",
      protocolVersion: "0.0.0",
      state,
      defaultProject,
      defaultProjectPath: projectPath,
      persistenceEnabled: false,
      stateStorePath: join(projectPath, "state.json"),
      stateSchemaVersion: 1,
      dispatchLeaseMs: 30_000,
      now: () => NOW,
    });

    state.channels.push({ id: "chn_review", provider: "wechat_ilink", ownerTeamId: "team_local" });
    state.channelConversations.push({
      id: "conv_review",
      channelId: "chn_review",
      externalUserId: "wx_review",
      ownerTeamId: "team_local",
    });
    state.channelTaskThreads.push({
      id: "cth_review",
      shortRef: "T-REVIEW",
      channelId: "chn_review",
      conversationId: "conv_review",
      status: "queued",
      workItemId: null,
      statusHistory: [],
    });
    state.channelTaskRequests.push({
      id: "ctr_review",
      channelId: "chn_review",
      conversationId: "conv_review",
      threadId: "cth_review",
      status: "pending",
      issueNumber: null,
    });

    const result = await deps.dismissChannelTask("ctr_review", OWNER);
    assert.equal(result.status, 200);
    const delivery = state.channelDeliveries.at(-1);
    assert.equal(delivery.content, "任务已被管理员忽略，未开始执行。");
    assert.doesNotMatch(delivery.content, /T-REVIEW|cth_review|Trace:/);
    assert.equal(delivery.taskContext.threadId, "cth_review");
  } finally {
    rmSync(projectPath, { recursive: true, force: true });
  }
});
