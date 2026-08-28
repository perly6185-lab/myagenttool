import test from "node:test";
import assert from "node:assert/strict";

import { projectWorkItemContextSummary } from "../src/services/work-item-context-summary.mjs";

test("projects one channel, template, material, and delivery context without duplicate content", () => {
  const item = {
    id: "wi_1",
    ownerTeamId: "team_1",
    intakeChannel: "chat",
    channelOrigin: { channelId: "chn_1", conversationId: "conv_1", threadId: "cth_1", messageId: "evt_1" },
    channelTaskContract: {
      dataSources: [{ kind: "channel_attachment", id: "asset_1" }],
    },
    myTemplateBinding: {
      definitionId: "rtd_quote",
      familyId: "rtf_quote",
      version: 3,
      name: "报价整理",
      expectedOutput: "比价表.xlsx",
      snapshotHash: "a".repeat(64),
    },
    inputAssets: [{
      id: "asset_1",
      contentId: "lc_same",
      originalName: "报价单.xlsx",
      hash: "sha256:one",
      readiness: { state: "ready", reason: "channel_attachment_ingested" },
    }],
    localContentRefs: [{
      id: "wcr_1",
      contentId: "lc_same",
      purpose: "reference",
      title: "报价单.xlsx",
      selectedFingerprint: "sha256:one",
    }],
    taskResourceRefs: [{
      id: "wrr_1",
      resourceId: "wres_remote",
      purpose: "query_source",
      title: "客户台账",
      locality: "remote",
      selectedVersion: "v4",
    }],
  };
  const state = {
    channels: [{ id: "chn_1", ownerTeamId: "team_1", provider: "wechat_ilink", name: "采购协作" }],
    channelTaskThreads: [{ id: "cth_1", workItemId: "wi_1", channelId: "chn_1", conversationId: "conv_1", sourceEventIds: ["evt_1", "evt_2"] }],
    channelDeliveries: [{
      id: "cdl_1",
      channelId: "chn_1",
      conversationId: "conv_1",
      status: "delivered",
      updatedAt: "2026-08-27T08:00:00.000Z",
      taskContext: { workItemId: "wi_1", threadId: "cth_1", deliveryKind: "result" },
    }],
  };

  const summary = projectWorkItemContextSummary({ item, state, ownerTeamId: "team_1" });

  assert.deepEqual(summary.origin, {
    kind: "channel",
    label: "采购协作",
    provider: "wechat_ilink",
    channelId: "chn_1",
    conversationId: "conv_1",
    threadId: "cth_1",
    sourceMessageCount: 2,
  });
  assert.equal(summary.method.kind, "template");
  assert.equal(summary.method.name, "报价整理");
  assert.equal(summary.materials.length, 2);
  assert.deepEqual(summary.materials.map((material) => [material.title, material.role, material.source]), [
    ["报价单.xlsx", "required_input", "channel_attachment"],
    ["客户台账", "query_source", "remote_resource"],
  ]);
  assert.deepEqual(summary.materials[0].allowedRoles, ["required_input"]);
  assert.deepEqual(summary.materials[1].allowedRoles, ["reference", "query_source"]);
  assert.deepEqual(summary.delivery, {
    destination: "channel",
    label: "采购协作",
    channelId: "chn_1",
    conversationId: "conv_1",
    status: "delivered",
  });
});

test("projects a manual task with a custom method and task-only delivery", () => {
  const summary = projectWorkItemContextSummary({
    item: { id: "wi_manual", ownerTeamId: "team_1", intakeChannel: "manual", title: "整理周报" },
    state: {},
    ownerTeamId: "team_1",
  });

  assert.equal(summary.origin.kind, "manual");
  assert.equal(summary.method.kind, "custom");
  assert.equal(summary.method.name, "本任务方案");
  assert.deepEqual(summary.materials, []);
  assert.equal(summary.delivery.destination, "task");
});

test("honors an explicit task-only result destination for a Channel task", () => {
  const summary = projectWorkItemContextSummary({
    item: {
      id: "wi_channel_local_result",
      ownerTeamId: "team_1",
      channelOrigin: { channelId: "chn_1", conversationId: "conv_1", threadId: "cth_1" },
      taskContextControl: { schemaVersion: 1, deliveryDestination: "task" },
    },
    state: {
      channels: [{ id: "chn_1", ownerTeamId: "team_1", name: "采购协作" }],
      channelTaskThreads: [{ id: "cth_1", workItemId: "wi_channel_local_result", channelId: "chn_1", conversationId: "conv_1" }],
    },
    ownerTeamId: "team_1",
  });

  assert.equal(summary.origin.kind, "channel");
  assert.deepEqual(summary.delivery, {
    destination: "task",
    label: "task",
    channelId: null,
    conversationId: null,
    status: null,
  });
});

test("does not use a cross-team channel label in the public projection", () => {
  const summary = projectWorkItemContextSummary({
    item: { id: "wi_1", ownerTeamId: "team_1", channelOrigin: { channelId: "chn_1" } },
    state: { channels: [{ id: "chn_1", ownerTeamId: "team_2", name: "Secret team channel" }] },
    ownerTeamId: "team_1",
  });

  assert.equal(summary.origin.kind, "channel");
  assert.equal(summary.origin.label, "Channel");
});
