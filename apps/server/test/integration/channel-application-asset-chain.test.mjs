import test from "node:test";
import assert from "node:assert/strict";
import { resolveLocalApplicationCapability } from "../../src/services/application-resolver.mjs";
import { createApplicationExecutionContract, normalizeApplicationResult } from "../../src/services/application-execution-contract.mjs";
import { createChannelTaskContext, extendChannelTaskContext } from "../../src/services/channel-task-context.mjs";

test("Channel attachment → local resolver → governed execution → output evidence → reply trace", () => {
  const terminalId = "terminal-1";
  const projectId = "project-1";
  const inputAsset = {
    id: "asset-xlsx", projectId, terminalId, path: "inbox/source.xlsx",
    family: "excel", hash: "sha256:input", version: "v1", readiness: { state: "ready" },
  };
  const channelContext = createChannelTaskContext({
    channel: { id: "channel-1" },
    conversation: { id: "conversation-1", channelId: "channel-1" },
    event: {
      id: "message-1", providerMessageId: "provider-1",
      channelId: "channel-1", conversationId: "conversation-1",
      attachmentAssets: [inputAsset],
    },
    identity: { id: "identity-1", userId: "user-1" },
    terminalId,
    projectId,
  });
  const resolution = resolveLocalApplicationCapability({
    assetVerb: "edit",
    assetFamily: "excel",
    terminalId,
    capabilities: [{
      name: "app.office.apply",
      displayName: "Update workbook",
      provider: { type: "application", id: "app-office" },
      application: { status: "active" },
      terminalId,
      invokable: true,
      requiresApproval: true,
      riskLevel: "medium",
      metadata: {
        readiness: { state: "ready", reason: "runtime_available" },
        assetVerbs: ["edit"],
        assetFamilies: ["excel"],
      },
    }],
  });
  assert.equal(resolution.state, "waiting_approval");

  const task = { id: "task-1", projectId, worktreeId: "worktree-1", terminalId };
  const execution = createApplicationExecutionContract({
    resolution,
    workItem: task,
    principalId: channelContext.principalId,
    approvalId: "approval-1",
    inputAssets: [inputAsset],
    outputContract: { collection: "applicationResults", assetFamilies: ["excel", "image"] },
  });
  const output = { assetId: "asset-image", hash: "sha256:output", version: "v2" };
  const result = normalizeApplicationResult({
    contract: execution,
    status: "succeeded",
    summary: "Workbook updated and preview evidence rendered.",
    outputRefs: [output],
  });
  const replyContext = extendChannelTaskContext(channelContext, {
    workItemId: task.id,
    invocationId: "invocation-1",
    deliveryId: "delivery-1",
    traceId: execution.traceId,
  });

  assert.equal(execution.terminalId, terminalId);
  assert.equal(result.taskId, task.id);
  assert.deepEqual(result.outputRefs, [output]);
  assert.equal(replyContext.principalId, "user-1");
  assert.equal(replyContext.traceId, task.id);
  assert.deepEqual(replyContext.invocationIds, ["invocation-1"]);
  assert.deepEqual(replyContext.deliveryIds, ["delivery-1"]);
  assert.equal(JSON.stringify({ resolution, execution, result, replyContext }).includes("command"), false);
});
