import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveLocalApplicationCapability } from "../../src/services/application-resolver.mjs";
import { createApplicationExecutionContract, normalizeApplicationResult } from "../../src/services/application-execution-contract.mjs";
import { ingestChannelAttachmentCandidates } from "../../src/services/channel-attachment-ingestion.mjs";
import { createChannelDeliveryService } from "../../src/services/channel-delivery.mjs";
import { createChannelTaskContext, extendChannelTaskContext } from "../../src/services/channel-task-context.mjs";

test("Channel attachment → local resolver → governed execution → output evidence → reply trace", async () => {
  const terminalId = "terminal-1";
  const projectId = "project-1";
  const projectPath = mkdtempSync(join(tmpdir(), "channel-chain-"));
  const zipHeader = Buffer.concat([Buffer.from("PK", "binary"), Buffer.from("governed workbook")]);
  const [inputAsset] = await ingestChannelAttachmentCandidates({
    candidates: [{ sourceUrl: "https://files.example.test/source.xlsx", filename: "source.xlsx" }],
    projectPath, projectId, terminalId,
    resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchAttachment: async () => new Response(zipHeader, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } }),
  });
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

  const state = {
    channels: [{ id: "channel-1", provider: "wecom", ownerTeamId: "team-1" }],
    channelConversations: [{
      id: "conversation-1", channelId: "channel-1", externalUserId: "external-1",
      ownerTeamId: "team-1",
    }],
    channelDeliveries: [],
  };
  const delivery = createChannelDeliveryService({
    state,
    now: () => "2026-07-25T00:00:00.000Z",
    nextId: () => "delivery-real-1",
    appendEvent: () => {},
  });
  const queued = delivery.notifyInvocationCompleted({
    id: "invocation-1",
    status: "succeeded",
    result: { summary: result.summary },
    options: { metadata: { channel: {
      channelId: "channel-1", conversationId: "conversation-1",
      workItemId: task.id, traceId: execution.traceId,
      terminalId, projectId,
    } } },
  });
  assert.equal(queued.ok, true);
  assert.match(state.channelDeliveries[0].content, /Task task-1: completed/);
  assert.match(state.channelDeliveries[0].content, /Trace: task-1/);
});
