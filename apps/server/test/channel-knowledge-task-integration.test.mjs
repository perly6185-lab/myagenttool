import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { createServerState } from "../src/runtime/state-factory.mjs";
import { createServerRuntimeServices } from "../src/runtime/service-composer.mjs";

const NOW = "2026-08-20T12:00:00.000Z";

test("restart recovery backfills a completed Channel article capture into My Tasks", () => {
  const root = mkdtempSync(join(tmpdir(), "myagenttool-channel-knowledge-task-"));
  const projectPath = join(root, "project");
  const stateStorePath = join(root, "state", "local.json");
  mkdirSync(projectPath, { recursive: true });
  mkdirSync(dirname(stateStorePath), { recursive: true });
  try {
    const seeded = createServerState({ defaultProjectPath: projectPath, now: () => NOW });
    const relativePath = "knowledge/channel-articles/team/project/docs/imported/wechat/article.md";
    const absolutePath = join(dirname(stateStorePath), relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, "# 已保存文章\n");
    seeded.state.channels.push({
      id: "chn_knowledge",
      provider: "ilink",
      ownerTeamId: "team_local",
      taskProjectId: seeded.defaultProject.id,
      taskTerminalId: "dev_local_001",
      operationMode: "personal",
      status: "active",
    });
    seeded.state.channelIdentities.push({
      id: "chid_knowledge",
      channelId: "chn_knowledge",
      externalUserId: "wx_owner",
      userId: "usr_local",
    });
    seeded.state.channelKnowledgeItems.push({
      id: "channel_knowledge_existing",
      ownerTeamId: "team_local",
      projectId: seeded.defaultProject.id,
      channelId: "chn_knowledge",
      conversationId: "conv_knowledge",
      status: "ready",
      title: "已保存文章",
      markdownPath: relativePath,
      htmlPath: null,
      manifestPath: null,
    });
    seeded.state.channelConversations.push({
      id: "conv_knowledge",
      channelId: "chn_knowledge",
      externalUserId: "wx_owner",
      sharedContentContext: {
        version: 1,
        status: "ready",
        activeItemIds: ["sct_existing"],
        items: [{
          id: "sct_existing",
          status: "ready",
          title: "已保存文章",
          sourceUrl: "https://mp.weixin.qq.com/s/existing",
          canonicalUrl: "https://mp.weixin.qq.com/s/existing",
          archiveStatus: "saved",
          knowledgeItemId: "channel_knowledge_existing",
        }],
      },
    });
    seeded.state.channelTaskThreads.push({
      id: "cth_knowledge_existing",
      channelId: "chn_knowledge",
      conversationId: "conv_knowledge",
      externalUserId: "wx_owner",
      sourceEventIds: ["evt_knowledge_existing"],
      sourceUrls: ["https://mp.weixin.qq.com/s/existing"],
      sharedContentIds: ["sct_existing"],
      workKind: "knowledge_capture",
      status: "succeeded",
      summary: "收纳链接资料：mp.weixin.qq.com",
      resultSummary: "已收纳 1 份资料到本地知识库。",
      createdAt: NOW,
      updatedAt: NOW,
    });

    createServerRuntimeServices({
      namespace: "test",
      protocolVersion: "0.0.0",
      state: seeded.state,
      defaultProject: seeded.defaultProject,
      defaultProjectPath: projectPath,
      persistenceEnabled: false,
      stateStorePath,
      stateSchemaVersion: 1,
      dispatchLeaseMs: 30_000,
      now: () => NOW,
    });

    const thread = seeded.state.channelTaskThreads.find((candidate) => candidate.id === "cth_knowledge_existing");
    const task = seeded.state.workItems.find((candidate) => candidate.id === thread.workItemId);
    assert.ok(task);
    assert.equal(task.status, "done");
    assert.match(task.title, /保存资料：已保存文章/);
    assert.match(task.body, /mp\.weixin\.qq\.com\/s\/existing/);
    assert.match(task.body, new RegExp(absolutePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(task.channelOrigin.threadId, thread.id);
    assert.match(thread.workItemLocalRef, /^LOCAL-/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
