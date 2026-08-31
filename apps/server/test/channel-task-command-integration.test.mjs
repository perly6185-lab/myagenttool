import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createServerRuntimeServices } from "../src/runtime/service-composer.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";

const NOW = "2026-08-31T06:00:00.000Z";
const OWNER = { userId: "usr_local", teamId: "team_local", role: "owner", authenticated: true };

test("task result redelivery uses the shared command receipt and survives approval-token replay", async () => {
  const projectPath = mkdtempSync(join(tmpdir(), "channel-task-command-"));
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
    state.channels.push({
      id: "chn_command",
      provider: "wechat_ilink",
      ownerTeamId: OWNER.teamId,
      status: "enabled",
    });
    const item = {
      id: "lwi_command",
      ownerTeamId: OWNER.teamId,
      projectId: defaultProject.id,
      revision: 4,
      executionBindings: [{ kind: "auto_run", targetId: "aur_command" }],
    };
    const autoRun = {
      id: "aur_command",
      localIssueId: item.id,
      teamId: OWNER.teamId,
      projectId: defaultProject.id,
      invocationId: "inv_command",
      status: "done",
      executionActionReceipts: [],
    };
    const delivery = {
      id: "chdl_command",
      channelId: "chn_command",
      conversationId: "conv_command",
      invocationId: "inv_command",
      status: "failed_terminal",
      attempts: 5,
      resendCount: 0,
      createdAt: NOW,
      updatedAt: NOW,
      taskContext: { workItemId: item.id, autoRunId: autoRun.id, deliveryKind: "result" },
    };
    state.workItems.push(item);
    state.autoRuns.push(autoRun);
    state.channelDeliveries.push(delivery);
    const approval = deps.issueApprovalGrant({
      action: "channel.delivery.retry",
      targetId: delivery.id,
    }, OWNER);
    assert.equal(approval.status, 201);
    const input = {
      channelId: delivery.channelId,
      deliveryId: delivery.id,
      approvalToken: approval.body.token,
      idempotencyKey: "task-result-redelivery-once",
    };

    const first = await deps.retryChannelDelivery(input, OWNER);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.status, "queued");
    assert.equal(first.body.actionReceipt.kind, "retry_channel_delivery");
    assert.equal(first.body.actionReceipt.status, "succeeded");
    assert.equal(first.body.replayed, false);
    assert.equal(delivery.resendCount, 1);
    assert.equal(state.executionActionIdempotencyRecords.length, 1);

    const replay = await deps.retryChannelDelivery(input, OWNER);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal(replay.body.actionReceipt.id, first.body.actionReceipt.id);
    assert.equal(delivery.resendCount, 1, "a consumed approval token cannot cause a second send");

    const secondDelivery = {
      ...delivery,
      id: "chdl_command_second",
      status: "failed_terminal",
      attempts: 5,
      resendCount: 0,
      lastManualRetryRequestId: null,
      updatedAt: "2026-08-31T06:01:00.000Z",
    };
    state.channelDeliveries.push(secondDelivery);
    state.channelDeliveries.push({
      ...secondDelivery,
      id: "chdl_status_notification",
      status: "failed_terminal",
      taskContext: { ...secondDelivery.taskContext, deliveryKind: "status_notification" },
      updatedAt: "2026-08-31T06:02:00.000Z",
    });
    state.channelTaskRequests.push({
      id: "ctr_command",
      channelId: delivery.channelId,
      status: "routed",
      workItemId: item.id,
      autoRunId: autoRun.id,
      invocationId: autoRun.invocationId,
    });
    const secondApproval = deps.issueApprovalGrant({
      action: "channel.delivery.retry",
      targetId: secondDelivery.id,
    }, OWNER);
    const commandResult = await deps.executeChannelTaskCommand("ctr_command", {
      kind: "retry_delivery",
      request: {
        approvalToken: secondApproval.body.token,
        idempotencyKey: "task-command-redelivery-once",
      },
    }, OWNER);
    assert.equal(commandResult.status, 200, JSON.stringify(commandResult.body));
    assert.equal(commandResult.body.kind, "retry_channel_delivery");
    assert.equal(commandResult.body.workItemId, item.id);
    assert.equal(commandResult.body.autoRunId, autoRun.id);
    assert.equal(commandResult.body.delivery.deliveryId, secondDelivery.id);
    assert.equal(commandResult.body.actionReceipt.status, "succeeded");
    assert.equal(Object.hasOwn(commandResult.body, "autoRun"), false, "Channel response does not expose the internal run object");
  } finally {
    rmSync(projectPath, { recursive: true, force: true });
  }
});
