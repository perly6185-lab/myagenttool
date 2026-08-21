import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPublicState } from "../src/read-models/state.mjs";

function build(channelConversations) {
  return buildPublicState({
    namespace: "test",
    protocolVersion: "1",
    state: {
      projects: [],
      invocations: [],
      channels: [{ id: "chn_1", ownerTeamId: "team_1" }],
      channelConversations,
    },
    defaultProjectPath: "/tmp",
    currentProject: () => null,
    defaultAgent: () => null,
    loopRoutineReadModel: () => null,
    codexApprovalQueue: () => [],
    evidenceCenterRecords: () => [],
    ledgerSummary: () => null,
    budgetStatuses: () => [],
    actor: { teamId: "team_1" },
  });
}

test("shared article context exposes metadata but keeps excerpts and analysis server-side", () => {
  const [conversation] = build([{
    id: "conv_1",
    channelId: "chn_1",
    sharedContentContext: {
      version: 1,
      status: "analyzed",
      lastAnalysis: "private analysis text",
      lastAnalysisAt: "2026-08-20T00:00:00.000Z",
      items: [{
        id: "article_1",
        title: "An article",
        sourceUrl: "https://mp.weixin.qq.com/s/example",
        status: "analyzed",
        excerpt: "bounded article body",
        archiveStatus: "not_saved",
        archiveFailureReason: "disk_secret_detail",
      }],
    },
  }]).channelConversations;

  assert.equal(conversation.sharedContentContext.lastAnalysis, undefined);
  assert.equal(conversation.sharedContentContext.items[0].excerpt, undefined);
  assert.equal(conversation.sharedContentContext.items[0].archiveFailureReason, undefined);
  assert.equal(conversation.sharedContentContext.items[0].archiveStatus, "not_saved");
  assert.equal(conversation.sharedContentContext.lastAnalysisAt, "2026-08-20T00:00:00.000Z");
  assert.equal(conversation.sharedContentContext.items[0].title, "An article");
  assert.equal(conversation.sharedContentContext.items[0].status, "analyzed");
});
