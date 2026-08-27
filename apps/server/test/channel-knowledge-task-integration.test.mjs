import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { createServerState } from "../src/runtime/state-factory.mjs";
import { createServerRuntimeServices } from "../src/runtime/service-composer.mjs";
import { ingestChannelAttachmentBytes } from "../src/services/channel-attachment-ingestion.mjs";

const NOW = "2026-08-20T12:00:00.000Z";

test("restart recovery keeps a completed Channel article capture out of My Tasks", async () => {
  const root = mkdtempSync(join(tmpdir(), "myagenttool-channel-knowledge-task-"));
  const projectPath = join(root, "project");
  const stateStorePath = join(root, "state", "local.json");
  mkdirSync(projectPath, { recursive: true });
  mkdirSync(dirname(stateStorePath), { recursive: true });
  let runtime = null;
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

    runtime = createServerRuntimeServices({
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
    const indexing = await runtime.startLocalContentIndexing();
    await runtime.flushLocalContentIndexing();

    const thread = seeded.state.channelTaskThreads.find((candidate) => candidate.id === "cth_knowledge_existing");
    assert.equal(thread.workItemId ?? null, null);
    assert.equal(thread.workItemLocalRef ?? null, null);
    assert.equal(seeded.state.channelKnowledgeItems[0].workItemId ?? null, null);
    assert.equal(seeded.state.workItems.some((item) => item.taskKind === "knowledge_capture"), false);
    const catalog = await runtime.httpDependencies.searchLocalContent({ query: "已保存文章" }, {
      userId: "usr_local", teamId: "team_local", role: "owner",
    });
    const article = catalog.body.results.find((record) => record.metadata?.channelKnowledgeItemId === "channel_knowledge_existing");
    assert.ok(article, JSON.stringify({ indexing, catalog: catalog.body }));
    assert.equal(article.workItemId, null);
    assert.equal(article.source.type, "channel_article_import");
    assert.equal(article.relations.some((relation) => relation.type === "produces_output"), false);
    assert.equal(article.relativePath, relativePath);
    assert.equal(article.original.available, true);
  } finally {
    await runtime?.closeRuntimeServices();
    rmSync(root, { recursive: true, force: true });
  }
});

test("the composed Channel pipeline saves a bare attachment to My files without creating a task", async () => {
  const root = mkdtempSync(join(tmpdir(), "myagenttool-channel-attachment-task-"));
  const projectPath = join(root, "project");
  const stateStorePath = join(root, "state", "local.json");
  mkdirSync(projectPath, { recursive: true });
  mkdirSync(dirname(stateStorePath), { recursive: true });
  let runtime = null;
  try {
    const seeded = createServerState({ defaultProjectPath: projectPath, now: () => NOW });
    seeded.state.channels.push({
      id: "chn_attachment",
      provider: "ilink",
      ownerTeamId: "team_local",
      taskProjectId: seeded.defaultProject.id,
      taskTerminalId: "dev_local_001",
      operationMode: "personal",
      status: "enabled",
      taskDailyLimit: 50,
    });
    seeded.state.channelIdentities.push({
      id: "chid_attachment",
      channelId: "chn_attachment",
      externalUserId: "wx_owner",
      userId: "usr_local",
    });
    const asset = await ingestChannelAttachmentBytes({
      filename: "客户反馈.txt",
      bytes: Buffer.from("客户希望缩短交付时间。\n"),
      contentType: "text/plain",
      projectPath,
      projectId: seeded.defaultProject.id,
      terminalId: "dev_local_001",
    });
    runtime = createServerRuntimeServices({
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

    const imported = await runtime.httpDependencies.importChannelEvent({
      channelId: "chn_attachment",
      providerMessageId: "msg_attachment_1",
      externalUserId: "wx_owner",
      msgType: "file",
      content: "[文件附件：客户反馈.txt]",
      attachmentAssets: [asset],
    });
    assert.equal(imported.ok, true);
    assert.equal(seeded.state.channelTaskThreads.length, 0);
    assert.equal(seeded.state.workItems.length, 0);
    assert.equal(seeded.state.channelAttachmentKnowledgeItems.length, 1);
    const event = seeded.state.channelEvents.find((candidate) => candidate.providerMessageId === "msg_attachment_1");
    assert.equal(event.attachmentKnowledgeStatus, "saved");
    assert.match(event.replyText, /保存到“我的资料”/);
    assert.match(event.replyText, /不会创建任务/);

    await runtime.startLocalContentIndexing();
    await runtime.flushLocalContentIndexing();
    const catalog = await runtime.httpDependencies.searchLocalContent({ query: "缩短交付时间" }, {
      userId: "usr_local", teamId: "team_local", role: "owner",
    });
    const material = catalog.body.results.find((record) => record.source.type === "channel_attachment_import");
    assert.ok(material, JSON.stringify(catalog.body));
    assert.equal(material.kind, "material");
    assert.equal(material.workItemId, null);
    assert.equal(material.original.available, true);
  } finally {
    await runtime?.closeRuntimeServices();
    rmSync(root, { recursive: true, force: true });
  }
});
