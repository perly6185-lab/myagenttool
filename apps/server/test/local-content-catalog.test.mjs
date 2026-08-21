import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import JSZip from "jszip";

import {
  collectLocalContent,
  createLocalContentCatalogService,
  localContentCatalogPath,
} from "../src/services/local-content-catalog.mjs";
import { parseWorkflowDocument } from "../src/services/workflow-document-parser.mjs";
import { handleLocalContentRoutes } from "../src/routes/local-content.mjs";
import { contentId } from "../src/services/local-content-records.mjs";

const actor = { userId: "usr_1", teamId: "team_1", role: "owner" };

async function writeArchive(path, files) {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  writeFileSync(path, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}

function fixture(serviceOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), "myagenttool-local-content-"));
  const stateStorePath = join(root, "state", "local-demo-state.json");
  const projectRoot = join(root, "project");
  const worktreeRoot = join(root, "worktree");
  const foreignRoot = join(root, "foreign");
  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(worktreeRoot, { recursive: true });
  mkdirSync(foreignRoot, { recursive: true });

  const articlePath = "docs/imported/wechat/2026/08/local-library/article.md";
  const outputPath = "deliverables/quarterly-result.txt";
  const inputStoredName = "tma_1--customer-brief.txt";
  const storageKey = (value) => createHash("sha256").update(value).digest("hex").slice(0, 24);
  const inputRelativePath = join("task-materials", storageKey("team_1"), storageKey("prj_1"), storageKey("tmd_1"), inputStoredName);
  mkdirSync(dirname(join(worktreeRoot, articlePath)), { recursive: true });
  mkdirSync(dirname(join(worktreeRoot, outputPath)), { recursive: true });
  mkdirSync(dirname(join(root, "state", inputRelativePath)), { recursive: true });
  writeFileSync(join(worktreeRoot, articlePath), `---
title: "本地资料库规划"
---
# 本地资料库规划

平台把原始文件保留在本机，并建立可重建的离线索引。
`);
  writeFileSync(join(worktreeRoot, outputPath), "季度结果已经整理完成，可以交付。\n");
  writeFileSync(join(root, "state", inputRelativePath), "客户要求提供一份本地检索方案。\n");
  writeFileSync(join(foreignRoot, "secret.txt"), "foreign private content\n");

  const state = {
    projects: [
      { id: "prj_1", ownerTeamId: "team_1", path: projectRoot },
      { id: "prj_foreign", ownerTeamId: "team_2", path: foreignRoot },
    ],
    worktrees: [{ id: "wtr_1", sourceProjectId: "prj_1", path: worktreeRoot }],
    workItems: [
      {
        id: "work_1",
        localRef: "LOCAL-1",
        ownerTeamId: "team_1",
        projectId: "prj_1",
        title: "整理本地知识资料",
        body: "把文章、邮件和任务文件组织起来。",
        status: "running",
        createdAt: "2026-08-14T01:00:00.000Z",
        updatedAt: "2026-08-14T02:00:00.000Z",
        inputAssets: [{
          id: "tma_1",
          originalName: "customer-brief.txt",
          path: ".myagenttool/inputs/work_1/tma_1--customer-brief.txt",
          family: "text",
          mimeType: "text/plain",
          terminalId: "device_1",
          size: 51,
          resourceClass: "small",
          capabilities: [],
          readiness: { state: "ready", reason: "stored" },
        }],
        outputAssets: [
          {
            id: "article_asset",
            path: articlePath,
            family: "markdown",
            mimeType: "text/markdown",
            terminalId: "device_1",
            worktreeId: "wtr_1",
            capabilities: [],
            readiness: { state: "ready", reason: "available" },
          },
          {
            id: "output_1",
            originalName: "quarterly-result.txt",
            path: outputPath,
            family: "text",
            mimeType: "text/plain",
            terminalId: "device_1",
            worktreeId: "wtr_1",
            capabilities: [],
            readiness: { state: "ready", reason: "available" },
          },
          {
            id: "missing_1",
            originalName: "removed.txt",
            path: "deliverables/removed.txt",
            family: "text",
            mimeType: "text/plain",
            terminalId: "device_1",
            worktreeId: "wtr_1",
            capabilities: [],
            readiness: { state: "ready", reason: "available" },
          },
          {
            id: "escape_1",
            originalName: "path-escape-attempt.txt",
            path: "../foreign/secret.txt",
            family: "text",
            mimeType: "text/plain",
            terminalId: "device_1",
            worktreeId: "wtr_1",
            capabilities: [],
            readiness: { state: "ready", reason: "available" },
          },
        ],
      },
      {
        id: "work_foreign",
        localRef: "LOCAL-9",
        ownerTeamId: "team_2",
        projectId: "prj_foreign",
        title: "Foreign secret task",
        body: "must not leak",
        outputAssets: [{
          id: "foreign_output",
          path: "secret.txt",
          terminalId: "device_2",
          capabilities: [],
          readiness: { state: "ready", reason: "available" },
        }],
      },
    ],
    taskMaterialDrafts: [{
      id: "tmd_1",
      ownerTeamId: "team_1",
      projectId: "prj_1",
      workItemId: "work_1",
      status: "claimed",
      assets: [{ id: "tma_1", storedName: inputStoredName }],
    }],
    articleImportJobs: [{
      id: "article_import_1",
      workItemId: "work_1",
      worktreeId: "wtr_1",
      canonicalUrl: "https://example.com/local-library",
      state: "completed",
      createdAt: "2026-08-14T01:10:00.000Z",
      completedAt: "2026-08-14T01:11:00.000Z",
      result: { markdownPath: articlePath },
    }],
    applications: [
      { id: "mail_app", ownerTeamId: "team_1", displayName: "Work Mail (legacy)", successorApplicationId: "mail_app_v2" },
      { id: "mail_app_v2", ownerTeamId: "team_1", displayName: "Work Mail", predecessorApplicationId: "mail_app" },
      { id: "foreign_mail_app", ownerTeamId: "team_2" },
    ],
    applicationResults: [
      {
        id: "result_mail_1",
        applicationId: "mail_app",
        ownerTeamId: "team_1",
        createdAt: "2026-08-14T01:20:00.000Z",
        data: {
          kind: "message",
          messageId: "<local@example.com>",
          from: "Alice <alice@example.com>",
          subject: "本地文件整理建议",
          body: "请把任务输入和输出都加入离线检索。",
          date: "2026-08-14T01:15:00.000Z",
          folderId: "inbox",
          folderPath: "INBOX",
          attachments: [],
        },
      },
      {
        id: "result_mail_foreign",
        applicationId: "foreign_mail_app",
        ownerTeamId: "team_2",
        createdAt: "2026-08-14T01:21:00.000Z",
        data: {
          kind: "message",
          messageId: "<foreign@example.com>",
          from: "Foreign Sender",
          subject: "Foreign secret mail",
          body: "must not leak",
        },
      },
    ],
    mailTaskLinks: [{ messageId: "<local@example.com>", workItemId: "work_1" }],
  };

  const service = createLocalContentCatalogService({
    state,
    stateStorePath,
    now: () => "2026-08-14T03:00:00.000Z",
    ...serviceOptions,
  });
  return {
    root,
    state,
    stateStorePath,
    articleFile: join(worktreeRoot, articlePath),
    worktreeRoot,
    foreignRoot,
    service,
    cleanup: async () => {
      await service.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("rebuilds a local-only catalog across articles, mail, tasks, inputs, and outputs", async () => {
  const fx = fixture();
  try {
    const articleBefore = readFileSync(fx.articleFile, "utf8");
    const modifiedBefore = statSync(fx.articleFile).mtimeMs;
    const rebuilt = await fx.service.rebuild({}, actor);
    assert.equal(rebuilt.status, 200);
    assert.equal(rebuilt.body.rebuild.originalFilesChanged, false);
    assert.deepEqual(rebuilt.body.catalog.byKind, {
      article: { count: 1, available: 1 },
      mail: { count: 1, available: 0 },
      task: { count: 1, available: 1 },
      task_input: { count: 1, available: 1 },
      task_output: { count: 3, available: 1 },
    });
    assert.equal(readFileSync(fx.articleFile, "utf8"), articleBefore);
    assert.equal(statSync(fx.articleFile).mtimeMs, modifiedBefore);
    assert.equal(existsSync(localContentCatalogPath(fx.stateStorePath)), true);
    assert.deepEqual(rebuilt.body.catalog.facets.mailAccounts, [
      { value: "mail_app_v2", label: "Work Mail", count: 1 },
    ]);
    assert.deepEqual(rebuilt.body.catalog.facets.mailFolders, [
      { value: "inbox", accountId: "mail_app_v2", accountLabel: "Work Mail", path: "INBOX", count: 1 },
    ]);

    const inbox = await fx.service.search({ kinds: ["mail"], mailAccountId: "mail_app_v2", mailFolderId: "inbox" }, actor);
    assert.equal(inbox.body.results.length, 1);
    const missingFolder = await fx.service.search({ kinds: ["mail"], mailAccountId: "mail_app_v2", mailFolderId: "sent" }, actor);
    assert.equal(missingFolder.body.results.length, 0);
    assert.equal((await fx.service.search({ mailFolderId: "inbox" }, actor)).status, 400);

    const article = await fx.service.search({ query: "可重建 离线索引" }, actor);
    assert.equal(article.status, 200);
    assert.equal(article.body.results[0].kind, "article");
    assert.equal(article.body.results[0].title, "本地资料库规划");
    assert.equal(article.body.results[0].relations.some((relation) => relation.type === "produces_output"), true);

    const sender = await fx.service.search({ query: "Alice" }, actor);
    assert.equal(sender.body.results.length, 1);
    assert.equal(sender.body.results[0].kind, "mail");
    assert.deepEqual(sender.body.results[0].original, {
      available: false,
      reason: "mail_original_not_archived",
    });
    assert.equal(sender.body.results[0].relations.some((relation) => relation.type === "converted_to_task"), true);

    const input = await fx.service.search({ query: "客户要求" }, actor);
    assert.equal(input.body.results[0].kind, "task_input");
    assert.equal(input.body.results[0].storageMode, "managed");
    assert.deepEqual(input.body.results[0].root, { kind: "application_data", id: "task-materials" });

    const output = await fx.service.search({ query: "季度结果" }, actor);
    assert.equal(output.body.results[0].kind, "task_output");
    assert.equal(output.body.results[0].original.available, true);

    const missing = await fx.service.search({ query: "removed.txt" }, actor);
    assert.equal(missing.body.results[0].indexStatus, "missing");
    assert.equal(missing.body.results[0].original.reason, "original_missing");

    const refused = await fx.service.search({ query: "path-escape-attempt" }, actor);
    assert.equal(refused.body.results[0].original.available, false);
    assert.equal(refused.body.results[0].relativePath, null);
    assert.equal(refused.body.results[0].original.reason, "original_path_unresolved");

    const serialized = JSON.stringify((await fx.service.search({}, actor)).body);
    assert.equal(serialized.includes(fx.root), false);
    assert.equal(serialized.includes("foreign private content"), false);
    assert.equal(serialized.includes("Foreign secret"), false);

    const ranked = await fx.service.search({ query: "本地", limit: 10 }, actor);
    const secondPage = await fx.service.search({ query: "本地", limit: 1, offset: 1 }, actor);
    assert.equal(ranked.body.results.length > 1, true);
    assert.equal(secondPage.body.results[0].id, ranked.body.results[1].id);
  } finally {
    await fx.cleanup();
  }
});

test("indexes a managed Channel article as the producing task's governed output", async () => {
  const fx = fixture();
  try {
    const knowledgeId = "channel_knowledge_managed";
    const managedPath = "knowledge/channel-articles/team/project/docs/imported/wechat/managed/article.md";
    const managedFile = join(dirname(fx.stateStorePath), managedPath);
    const managedImage = join(dirname(managedFile), "assets", "001-preview.png");
    const managedContentId = contentId("article", "team_1", knowledgeId);
    mkdirSync(dirname(managedFile), { recursive: true });
    mkdirSync(dirname(managedImage), { recursive: true });
    writeFileSync(managedFile, "# Channel 客户背调资料\n\n这是一份通过 iLink 收纳的本地文章。\n\n![配图](assets/001-preview.png)\n");
    writeFileSync(managedImage, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    fx.state.channelKnowledgeItems = [{
      id: knowledgeId,
      ownerTeamId: "team_1",
      projectId: "prj_1",
      workItemId: "work_1",
      channelId: "chn_1",
      conversationId: "conv_1",
      status: "ready",
      title: "Channel 客户背调资料",
      markdownPath: managedPath,
      sourceUrl: "https://mp.weixin.qq.com/s/managed",
      canonicalUrl: "https://mp.weixin.qq.com/s/managed",
      completedAt: "2026-08-20T10:01:34.428Z",
    }];
    fx.state.workItems[0].outputAssets.push({
      id: `asset_channel_knowledge_${knowledgeId}`,
      contentId: managedContentId,
      originalName: "Channel 客户背调资料.md",
      path: managedPath,
      family: "markdown",
      mimeType: "text/markdown",
      terminalId: "device_1",
      capabilities: ["discover", "preview", "inspect", "open_external", "attach_evidence"],
      readiness: { state: "ready", reason: "managed_channel_knowledge" },
    });

    const immediatePreview = await fx.service.preview({ contentId: managedContentId }, actor);
    assert.equal(immediatePreview.status, 200);
    assert.match(immediatePreview.body.preview.text, /通过 iLink 收纳/);
    const immediateHealth = await fx.service.health({ contentIds: [managedContentId] }, actor);
    assert.equal(immediateHealth.body.health[0].state, "ready");
    const immediateImage = await fx.service.previewAsset({
      contentId: managedContentId,
      relativePath: "assets/001-preview.png",
    }, actor);
    assert.equal(immediateImage.status, 200);
    assert.equal(immediateImage.mimeType, "image/png");
    assert.deepEqual(immediateImage.bytes, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    assert.equal((await fx.service.previewAsset({
      contentId: managedContentId,
      relativePath: "../secret.png",
    }, actor)).status, 400);
    assert.equal((await fx.service.previewAsset({
      contentId: managedContentId,
      relativePath: "assets/001-preview.svg",
    }, actor)).status, 415);

    await fx.service.rebuild({}, actor);
    const result = await fx.service.search({ query: "iLink 收纳" }, actor);
    const article = result.body.results.find((record) => record.id === managedContentId);
    assert.ok(article);
    assert.equal(article.workItemId, "work_1");
    assert.deepEqual(article.root, { kind: "application_data", id: "channel-knowledge" });
    assert.equal(article.relations.some((relation) => relation.type === "produces_output" && relation.contentId !== managedContentId), true);
    const preview = await fx.service.preview({ contentId: managedContentId }, actor);
    assert.equal(preview.status, 200);
    assert.match(preview.body.preview.text, /通过 iLink 收纳/);
    assert.deepEqual(
      await fx.service.preview({ contentId: managedContentId }, { ...actor, teamId: "team_2" }),
      { status: 404, body: { error: "local_content_not_found" } },
    );
    assert.equal((await fx.service.previewAsset({
      contentId: managedContentId,
      relativePath: "assets/001-preview.png",
    }, { ...actor, teamId: "team_2" })).status, 404);
  } finally {
    await fx.cleanup();
  }
});

test("catalog search is tenant and project scoped and rejects unknown kinds", async () => {
  const fx = fixture();
  try {
    await fx.service.rebuild({}, actor);
    const foreignSearch = await fx.service.search({ query: "Foreign" }, actor);
    assert.deepEqual(foreignSearch.body.results, []);

    const foreignActor = { userId: "usr_2", teamId: "team_2", role: "owner" };
    const foreignOwnSearch = await fx.service.search({ query: "Foreign" }, foreignActor);
    assert.equal(foreignOwnSearch.body.results.length, 3);
    assert.deepEqual(
      new Set(foreignOwnSearch.body.results.map((result) => result.kind)),
      new Set(["mail", "task", "task_output"]),
    );

    const hiddenProject = await fx.service.search({ projectId: "prj_foreign" }, actor);
    assert.deepEqual(hiddenProject, { status: 404, body: { error: "project_not_found" } });
    const invalidKind = await fx.service.search({ kinds: ["credential"] }, actor);
    assert.deepEqual(invalidKind, { status: 400, body: { error: "local_content_kind_invalid" } });
  } finally {
    await fx.cleanup();
  }
});

test("catalog search combines FTS body hits with metadata-only hits", async () => {
  const fx = fixture();
  try {
    fx.state.applicationResults.push({
      id: "result_mail_body_hit",
      applicationId: "mail_app",
      ownerTeamId: "team_1",
      createdAt: "2026-08-14T01:22:00.000Z",
      data: {
        kind: "message",
        messageId: "<body-hit@example.com>",
        from: "Bob <bob@example.com>",
        subject: "Body-only match",
        body: "Alice is named in this message body.",
      },
    });
    await fx.service.rebuild({}, actor);
    const result = await fx.service.search({ query: "Alice", kinds: ["mail"] }, actor);
    assert.deepEqual(new Set(result.body.results.map((record) => record.title)), new Set([
      "本地文件整理建议",
      "Body-only match",
    ]));
  } finally {
    await fx.cleanup();
  }
});

test("catalog can be deleted and rebuilt without changing originals", async () => {
  const fx = fixture();
  try {
    await fx.service.rebuild({}, actor);
    const first = await fx.service.search({ query: "本地资料库规划" }, actor);
    assert.equal(first.body.results.length, 1);
    await fx.service.close();
    rmSync(localContentCatalogPath(fx.stateStorePath), { force: true });

    const restored = createLocalContentCatalogService({
      state: fx.state,
      stateStorePath: fx.stateStorePath,
      now: () => "2026-08-14T03:05:00.000Z",
    });
    await restored.rebuild({}, actor);
    const second = await restored.search({ query: "本地资料库规划" }, actor);
    assert.equal(second.body.results.length, 1);
    assert.equal(second.body.results[0].kind, "article");
    await restored.close();
  } finally {
    await fx.cleanup();
  }
});

test("catalog resolves confined originals for execution and detects source changes", async () => {
  const fx = fixture();
  try {
    await fx.service.rebuild({}, actor);
    const article = (await fx.service.search({ query: "本地资料库规划" }, actor)).body.results[0];
    const resolved = await fx.service.resolveOriginal({ contentId: article.id, projectId: "prj_1" }, actor);
    assert.equal(resolved.ok, true);
    assert.equal(resolved.sourceType, "file");
    assert.equal(readFileSync(resolved.localPath, "utf8").includes("可重建的离线索引"), true);
    assert.match(resolved.sha256, /^sha256:[a-f0-9]{64}$/);

    const hidden = await fx.service.resolveOriginal({ contentId: article.id }, { ...actor, teamId: "team_2" });
    assert.deepEqual(hidden, { ok: false, status: 404, error: "local_content_not_found" });

    const task = (await fx.service.search({ query: "整理本地知识资料", kinds: ["task"] }, actor)).body.results[0];
    const taskSource = await fx.service.resolveOriginal({ contentId: task.id, projectId: "prj_1" }, actor);
    assert.equal(taskSource.ok, true);
    assert.equal(taskSource.sourceType, "bytes");
    assert.equal(taskSource.bytes.toString("utf8").includes("把文章、邮件和任务文件组织起来"), true);

    writeFileSync(fx.articleFile, "changed after indexing\n");
    const changed = await fx.service.resolveOriginal({ contentId: article.id, projectId: "prj_1" }, actor);
    assert.equal(changed.ok, false);
    assert.equal(changed.error, "local_content_original_changed");
  } finally {
    await fx.cleanup();
  }
});

test("catalog projects task content references and output lineage without duplicate records", async () => {
  const fx = fixture();
  try {
    await fx.service.rebuild({}, actor);
    const input = (await fx.service.search({ query: "客户要求", kinds: ["task_input"] }, actor)).body.results[0];
    fx.state.workItems[0].localContentRefs = [{ id: "wcr_1", contentId: input.id, purpose: "required_input" }];
    await fx.service.rebuild({}, actor);

    const task = (await fx.service.search({ query: "整理本地知识资料", kinds: ["task"] }, actor)).body.results[0];
    assert.equal(task.relations.some((relation) => relation.type === "uses_input" && relation.contentId === input.id), true);
    const output = (await fx.service.search({ query: "季度结果", kinds: ["task_output"] }, actor)).body.results[0];
    assert.equal(output.relations.some((relation) => relation.type === "derived_from" && relation.contentId === input.id), true);
  } finally {
    await fx.cleanup();
  }
});

test("the same physical original is grouped across task contexts without copying bytes", async () => {
  const fx = fixture();
  try {
    fx.state.workItems.push({
      id: "work_2",
      localRef: "LOCAL-2",
      ownerTeamId: "team_1",
      projectId: "prj_1",
      title: "Reuse quarterly result",
      body: "Use the existing result without copying it.",
      createdAt: "2026-08-14T02:10:00.000Z",
      updatedAt: "2026-08-14T02:10:00.000Z",
      inputAssets: [],
      outputAssets: [{
        id: "reused_output",
        originalName: "quarterly-result.txt",
        path: "deliverables/quarterly-result.txt",
        family: "text",
        mimeType: "text/plain",
        terminalId: "device_1",
        worktreeId: "wtr_1",
        capabilities: [],
        readiness: { state: "ready", reason: "available" },
      }],
    });
    const before = readFileSync(join(fx.worktreeRoot, "deliverables", "quarterly-result.txt"));
    await fx.service.rebuild({}, actor);
    const results = (await fx.service.search({ query: "季度结果", kinds: ["task_output"] }, actor)).body.results;
    assert.equal(results.length, 2);
    assert.equal(results.every((record) => record.sameContent?.appearances === 2), true);
    assert.equal(results.every((record) => record.relations.some((relation) => relation.type === "same_content" && relation.title)), true);
    assert.deepEqual(readFileSync(join(fx.worktreeRoot, "deliverables", "quarterly-result.txt")), before);
  } finally {
    await fx.cleanup();
  }
});

test("catalog reports a verified mail archive as a managed available original", async () => {
  const fx = fixture();
  try {
    const archiveRef = `mailarc_${"a".repeat(24)}_${"b".repeat(40)}`;
    fx.state.applicationResults[0].data.archive = {
      version: 1,
      ref: archiveRef,
      availability: "available",
      sha256: "c".repeat(64),
      size: 2048,
      archivedAt: "2026-08-14T01:20:00.000Z",
    };
    await fx.service.rebuild({}, actor);
    const result = await fx.service.search({ query: "本地文件整理建议" }, actor);
    assert.equal(result.body.results[0].storageMode, "managed");
    assert.deepEqual(result.body.results[0].root, { kind: "mail_archive", id: archiveRef });
    assert.deepEqual(result.body.results[0].original, { available: true, reason: null });
    assert.equal(result.body.results[0].mimeType, "message/rfc822");
    assert.equal(JSON.stringify(result.body).includes("c".repeat(64)), false, "content hashes remain catalog internals, not ordinary UI fields");
  } finally { await fx.cleanup(); }
});

test("catalog resolves the single archived eml original for execution", async () => {
  const fx = fixture();
  let service;
  try {
    const archiveRef = `mailarc_${"a".repeat(24)}_${"b".repeat(40)}`;
    const bytes = Buffer.from("From: alice@example.com\r\nSubject: Local archive\r\n\r\nArchived body\r\n", "utf8");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const archiveRoot = join(fx.root, "mail-archive");
    const directory = join(archiveRoot, "a".repeat(24), archiveRef);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "message.eml"), bytes);
    fx.state.applicationResults[0].data.archive = {
      version: 1,
      ref: archiveRef,
      availability: "available",
      sha256,
      size: bytes.length,
      archivedAt: "2026-08-14T01:20:00.000Z",
    };
    service = createLocalContentCatalogService({
      state: fx.state,
      stateStorePath: fx.stateStorePath,
      databasePath: join(fx.root, "mail-catalog.sqlite"),
      mailArchiveRoot: archiveRoot,
      now: () => "2026-08-14T03:00:00.000Z",
    });
    await service.rebuild({}, actor);
    const mail = (await service.search({ query: "本地文件整理建议", kinds: ["mail"] }, actor)).body.results[0];
    const resolved = await service.resolveOriginal({ contentId: mail.id }, actor);
    assert.equal(resolved.ok, true);
    assert.equal(resolved.originalName.endsWith(".eml"), true);
    assert.deepEqual(readFileSync(resolved.localPath), bytes);
    const preview = await service.preview({ contentId: mail.id }, actor);
    assert.equal(preview.status, 200);
    assert.match(preview.body.preview.text, /From: Alice/);
    assert.match(preview.body.preview.text, /请把任务输入和输出都加入离线检索/);
    assert.equal(preview.body.preview.text.includes("Archived body"), false, "the library shows the parsed message rather than raw MIME");
  } finally {
    await service?.close();
    await fx.cleanup();
  }
});

test("catalog previews text without exposing paths and neutralizes active HTML", async () => {
  const fx = fixture();
  try {
    const htmlPath = "deliverables/untrusted-page.html";
    mkdirSync(dirname(join(fx.worktreeRoot, htmlPath)), { recursive: true });
    writeFileSync(join(fx.worktreeRoot, htmlPath), '<h1>Safe heading</h1><script>window.evil = true</script><img src="https://tracker.example/pixel"><p>Visible body</p>');
    fx.state.workItems[0].outputAssets.push({
      id: "html_1",
      originalName: "untrusted-page.html",
      path: htmlPath,
      family: "html",
      mimeType: "text/html",
      terminalId: "device_1",
      worktreeId: "wtr_1",
      capabilities: [],
      readiness: { state: "ready", reason: "available" },
    });
    await fx.service.rebuild({}, actor);
    const record = (await fx.service.search({ query: "untrusted-page", kinds: ["task_output"] }, actor)).body.results[0];
    const preview = await fx.service.preview({ contentId: record.id }, actor);
    assert.equal(preview.status, 200);
    assert.equal(preview.body.preview.format, "plain_text");
    assert.equal(preview.body.preview.text.includes("Safe heading"), true);
    assert.equal(preview.body.preview.text.includes("Visible body"), true);
    assert.equal(preview.body.preview.text.includes("window.evil"), false);
    assert.equal(preview.body.preview.text.includes("tracker.example"), true, "remote URLs remain visible as inert text");
    assert.equal(preview.body.preview.activeContentExecuted, false);
    assert.equal(preview.body.preview.remoteResourcesLoaded, false);
    assert.equal(JSON.stringify(preview.body).includes(fx.root), false);
    const urlSearch = await fx.service.search({ query: "tracker.example", kinds: ["task_output"] }, actor);
    assert.equal(urlSearch.body.results[0].id, record.id, "inert link targets remain searchable");

    const hidden = await fx.service.preview({ contentId: record.id }, { ...actor, teamId: "team_2" });
    assert.deepEqual(hidden, { status: 404, body: { error: "local_content_not_found" } });
  } finally {
    await fx.cleanup();
  }
});

test("catalog reads native text beyond the preview limit with UTF-8-safe continuation offsets", async () => {
  const fx = fixture();
  try {
    writeFileSync(fx.articleFile, "你".repeat(400_000));
    await fx.service.rebuild({}, actor);
    const searched = await fx.service.search({ kinds: ["article"], limit: 10 }, actor);
    const article = searched.body.results.find((record) => record.kind === "article");
    assert.ok(article);

    const first = await fx.service.readTextChunk({ contentId: article.id, offset: 0, limit: 1 }, actor);
    assert.equal(first.status, 200);
    assert.equal(first.body.chunk.text, "你");
    assert.equal(first.body.chunk.nextOffset, 3);
    assert.equal(first.body.chunk.text.includes("�"), false);

    const beyondPreview = await fx.service.readTextChunk({
      contentId: article.id,
      offset: 1_048_575,
      limit: 10,
    }, actor);
    assert.equal(beyondPreview.status, 200);
    assert.equal(beyondPreview.body.chunk.text, "你".repeat(10));
    assert.equal(beyondPreview.body.chunk.nextOffset, 1_048_605);
    assert.equal(beyondPreview.body.chunk.eof, false);
    assert.equal(beyondPreview.body.chunk.sourceTruncated, false);
  } finally {
    await fx.cleanup();
  }
});

test("catalog indexes and safely previews extracted Office text without executing the document", async () => {
  const fx = fixture();
  try {
    const relativePath = "deliverables/project-plan.docx";
    const path = join(fx.worktreeRoot, relativePath);
    await writeArchive(path, {
      "word/document.xml": `<w:document xmlns:w="w"><w:body>
        <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>离线文档索引方案</w:t></w:r></w:p>
        <w:p><w:r><w:t>按来源日志增量更新，不执行宏或外部资源。</w:t></w:r></w:p>
      </w:body></w:document>`,
    });
    fx.state.workItems[0].outputAssets.push({
      id: "docx_1",
      originalName: "project-plan.docx",
      path: relativePath,
      family: "word",
      terminalId: "device_1",
      worktreeId: "wtr_1",
      capabilities: [],
      readiness: { state: "ready", reason: "available" },
    });

    await fx.service.rebuild({}, actor);
    const record = (await fx.service.search({ query: "来源日志增量更新", kinds: ["task_output"] }, actor)).body.results[0];
    assert.equal(record.title, "project-plan.docx");
    assert.equal(record.indexStatus, "ready");
    const preview = await fx.service.preview({ contentId: record.id }, actor);
    assert.equal(preview.status, 200);
    assert.match(preview.body.preview.text, /离线文档索引方案[\s\S]*来源日志增量更新/);
    assert.equal(preview.body.preview.extraction.parserVersion, 1);
    assert.equal(preview.body.preview.activeContentExecuted, false);
    assert.equal(preview.body.preview.remoteResourcesLoaded, false);
    assert.equal(JSON.stringify(preview.body).includes(fx.root), false);
  } finally {
    await fx.cleanup();
  }
});

test("incremental jobs update only changed records and survive a service restart", async () => {
  const fx = fixture();
  let restored;
  try {
    await fx.service.rebuild({}, actor);
    writeFileSync(fx.articleFile, "# Updated local article\n\nIncremental indexing found this phrase.\n");
    await fx.service.requestIncremental({ reason: "article_changed", immediate: true }, actor);
    const first = await fx.service.flushIncremental({}, actor);
    assert.equal(first.body.incremental.processed, true);
    assert.equal(first.body.incremental.updated >= 1, true);
    assert.equal(first.body.incremental.originalFilesChanged, false);
    const updated = await fx.service.search({ query: "Incremental indexing found", kinds: ["article"] }, actor);
    assert.equal(updated.body.results.length, 1);

    await fx.service.requestIncremental({ reason: "no_change" }, actor);
    await fx.service.close();
    restored = createLocalContentCatalogService({
      state: fx.state,
      stateStorePath: fx.stateStorePath,
      now: () => "2026-08-14T04:00:00.000Z",
    });
    const resumed = await restored.flushIncremental({}, actor);
    assert.equal(resumed.body.incremental.processed, true);
    assert.equal(resumed.body.incremental.added, 0);
    assert.equal(resumed.body.incremental.updated, 0);
    assert.equal(resumed.body.incremental.removed, 0);
    assert.equal(resumed.body.incremental.unchanged > 0, true);
    assert.deepEqual((await restored.stats(actor)).body.catalog.indexing, { queued: 0, running: 0, failed: 0 });
  } finally {
    await restored?.close();
    await fx.cleanup();
  }
});

test("incremental jobs merge source journals and leave unrequested sources untouched", async () => {
  const fx = fixture();
  try {
    await fx.service.rebuild({}, actor);
    writeFileSync(fx.articleFile, "# Deferred article update\n\nOnly the article source should see this phrase.\n");
    fx.state.applicationResults[0].data.body = "Mail journal update is immediately searchable.";

    await fx.service.requestIncremental({ reason: "mail_changed", sources: ["mail"] }, actor);
    const mailOnly = await fx.service.flushIncremental({}, actor);
    assert.deepEqual(mailOnly.body.incremental.sources, ["mail"]);
    assert.equal((await fx.service.search({ query: "Mail journal update", kinds: ["mail"] }, actor)).body.results.length, 1);
    assert.equal((await fx.service.search({ query: "Deferred article update", kinds: ["article"] }, actor)).body.results.length, 0);

    await fx.service.requestIncremental({ reason: "article_changed", sources: ["articles"] }, actor);
    await fx.service.requestIncremental({ reason: "task_changed", sources: ["work_items"] }, actor);
    const merged = await fx.service.flushIncremental({}, actor);
    assert.deepEqual(merged.body.incremental.sources, ["articles", "work_items"]);
    assert.equal((await fx.service.search({ query: "Deferred article update", kinds: ["article"] }, actor)).body.results.length, 1);
  } finally {
    await fx.cleanup();
  }
});

test("a rebuild preserves changes queued while its snapshot is being collected", async () => {
  const fx = fixture();
  let service;
  try {
    let pauseNext = false;
    let collectionStarted;
    let releaseCollection;
    const started = new Promise((resolveStarted) => { collectionStarted = resolveStarted; });
    const release = new Promise((resolveRelease) => { releaseCollection = resolveRelease; });
    const collectContent = async (input) => {
      const built = await collectLocalContent(input);
      if (pauseNext) {
        collectionStarted();
        await release;
      }
      return built;
    };
    service = createLocalContentCatalogService({
      state: fx.state,
      stateStorePath: fx.stateStorePath,
      databasePath: join(fx.root, "race-catalog.sqlite"),
      collectContent,
      indexDebounceMs: 60_000,
    });
    await service.rebuild({}, actor);

    pauseNext = true;
    const rebuilding = service.rebuild({}, actor);
    await started;
    fx.state.workItems[0].title = "Changed during complete rebuild";
    await service.requestIncremental({ reason: "during_rebuild", sources: ["work_items"] }, actor);
    releaseCollection();
    await rebuilding;

    assert.equal((await service.search({ query: "Changed during complete rebuild", kinds: ["task"] }, actor)).body.results.length, 0);
    assert.equal((await service.stats(actor)).body.catalog.indexing.queued, 1);
    await service.flushIncremental({}, actor);
    assert.equal((await service.search({ query: "Changed during complete rebuild", kinds: ["task"] }, actor)).body.results.length, 1);
  } finally {
    await service?.close();
    await fx.cleanup();
  }
});

test("a successful incremental pass clears older failed-job health", async () => {
  const fx = fixture();
  let service;
  try {
    let failCollection = false;
    service = createLocalContentCatalogService({
      state: fx.state,
      stateStorePath: fx.stateStorePath,
      databasePath: join(fx.root, "recovery-catalog.sqlite"),
      collectContent: async (input) => {
        if (failCollection) throw new Error("simulated extraction outage");
        return collectLocalContent(input);
      },
      indexDebounceMs: 60_000,
    });
    await service.rebuild({}, actor);
    failCollection = true;
    await service.requestIncremental({ reason: "fails_once", sources: ["work_items"] }, actor);
    await assert.rejects(service.flushIncremental({}, actor), /simulated extraction outage/);
    assert.equal((await service.stats(actor)).body.catalog.indexing.failed, 1);

    failCollection = false;
    await service.requestIncremental({ reason: "recovers", sources: ["work_items"] }, actor);
    await service.flushIncremental({}, actor);
    assert.equal((await service.stats(actor)).body.catalog.indexing.failed, 0);
  } finally {
    await service?.close();
    await fx.cleanup();
  }
});

test("unchanged Office originals reuse extraction across work-item index events", async () => {
  const fx = fixture();
  let service;
  try {
    const relativePath = "deliverables/cached-plan.docx";
    await writeArchive(join(fx.worktreeRoot, relativePath), {
      "word/document.xml": `<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Reusable extracted plan</w:t></w:r></w:p></w:body></w:document>`,
    });
    fx.state.workItems[0].outputAssets.push({
      id: "cached_docx",
      originalName: "cached-plan.docx",
      path: relativePath,
      family: "word",
      worktreeId: "wtr_1",
    });
    let parseCount = 0;
    service = createLocalContentCatalogService({
      state: fx.state,
      stateStorePath: fx.stateStorePath,
      databasePath: join(fx.root, "cache-catalog.sqlite"),
      parseDocument: async (input) => {
        parseCount += 1;
        return parseWorkflowDocument(input);
      },
      indexDebounceMs: 60_000,
    });
    await service.rebuild({}, actor);
    assert.equal(parseCount, 1);
    fx.state.workItems[0].body = "Task metadata changed without changing the document.";
    await service.requestIncremental({ reason: "task_metadata_changed", sources: ["work_items"] }, actor);
    await service.flushIncremental({}, actor);
    assert.equal(parseCount, 1);
    assert.equal((await service.search({ query: "Reusable extracted plan", kinds: ["task_output"] }, actor)).body.results.length, 1);
  } finally {
    await service?.close();
    await fx.cleanup();
  }
});

test("catalog drops cross-team relationships from malformed persisted references", async () => {
  const fx = fixture();
  try {
    await fx.service.rebuild({}, actor);
    const foreignActor = { userId: "usr_2", teamId: "team_2", role: "owner" };
    const foreign = (await fx.service.search({ query: "Foreign secret", limit: 1 }, foreignActor)).body.results[0];
    fx.state.workItems[0].localContentRefs = [{ id: "bad_cross_team_ref", contentId: foreign.id, purpose: "reference" }];
    await fx.service.rebuild({}, actor);
    const localTask = (await fx.service.search({ query: "整理本地知识资料", kinds: ["task"] }, actor)).body.results[0];
    assert.equal(localTask.relations.some((relation) => relation.contentId === foreign.id), false);
  } finally {
    await fx.cleanup();
  }
});

test("catalog refuses a symlinked original instead of indexing its target", async (t) => {
  const fx = fixture();
  try {
    const linkPath = join(fx.worktreeRoot, "deliverables", "linked-secret.txt");
    try {
      symlinkSync(join(fx.foreignRoot, "secret.txt"), linkPath, "file");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOSYS"].includes(error?.code)) {
        t.skip(`symlink unavailable on this host: ${error.code}`);
        return;
      }
      throw error;
    }
    fx.state.workItems[0].outputAssets.push({
      id: "symlink_1",
      originalName: "linked-secret.txt",
      path: "deliverables/linked-secret.txt",
      family: "text",
      mimeType: "text/plain",
      terminalId: "device_1",
      worktreeId: "wtr_1",
      capabilities: [],
      readiness: { state: "ready", reason: "available" },
    });
    await fx.service.rebuild({}, actor);
    const result = await fx.service.search({ query: "linked-secret" }, actor);
    assert.equal(result.body.results.length, 1);
    assert.equal(result.body.results[0].original.available, false);
    assert.equal(result.body.results[0].original.reason, "original_path_symlink");
    assert.equal(JSON.stringify(result.body).includes("foreign private content"), false);
  } finally {
    await fx.cleanup();
  }
});

test("logical directory filters, snippets, facets, and opaque cursors remain usable beyond offset paging", async () => {
  const fx = fixture();
  try {
    await fx.service.rebuild({}, actor);
    const filtered = await fx.service.search({
      workItemId: "work_1",
      sourceType: "article_import",
      yearMonth: "2026-08",
      availability: "available",
      indexStatus: "ready",
    }, actor);
    assert.equal(filtered.body.results.length, 1);
    assert.equal(filtered.body.results[0].kind, "article");
    assert.match(filtered.body.results[0].sourceLabel, /整理本地知识资料/);

    const matched = await fx.service.search({ query: "可重建", kinds: ["article"] }, actor);
    assert.match(matched.body.results[0].matchSnippet, /可重建/);

    const first = await fx.service.search({ limit: 1 }, actor);
    assert.match(first.body.nextCursor, /^[A-Za-z0-9_-]+$/);
    const second = await fx.service.search({ limit: 1, cursor: first.body.nextCursor }, actor);
    assert.notEqual(second.body.results[0].id, first.body.results[0].id);
    const crossQuery = await fx.service.search({ query: "local", limit: 1, cursor: first.body.nextCursor }, actor);
    assert.deepEqual(crossQuery, { status: 400, body: { error: "local_content_cursor_invalid" } });
    await fx.service.rebuild({}, actor);
    const stale = await fx.service.search({ limit: 1, cursor: first.body.nextCursor }, actor);
    assert.deepEqual(stale, { status: 400, body: { error: "local_content_cursor_invalid" } });
    const invalid = await fx.service.search({ cursor: "not-a-cursor" }, actor);
    assert.deepEqual(invalid, { status: 400, body: { error: "local_content_cursor_invalid" } });

    const stats = await fx.service.stats(actor);
    assert.equal(stats.body.catalog.facets.workItems.some((facet) => facet.value === "work_1"), true);
    assert.equal(stats.body.catalog.facets.months.some((facet) => facet.value === "2026-08"), true);
    assert.equal(stats.body.catalog.facets.coverage.workItems.truncated, false);

    const directoryFirst = await fx.service.browseDirectories({ dimension: "work_item", limit: 1 }, actor);
    assert.equal(directoryFirst.status, 200);
    assert.equal(directoryFirst.body.entries[0].value, "work_1");
    const directorySearch = await fx.service.browseDirectories({ dimension: "work_item", query: "work_1" }, actor);
    assert.deepEqual(directorySearch.body.entries, [{ value: "work_1", count: 6 }]);
    const invalidDirectory = await fx.service.browseDirectories({ dimension: "absolute_path" }, actor);
    assert.deepEqual(invalidDirectory, { status: 400, body: { error: "local_content_directory_dimension_invalid" } });
  } finally {
    await fx.cleanup();
  }
});

test("reference health detects changed and missing originals and supports scoped refresh and container recovery", async () => {
  const fx = fixture();
  try {
    await fx.service.rebuild({}, actor);
    const article = (await fx.service.search({ kinds: ["article"] }, actor)).body.results[0];
    assert.equal((await fx.service.health({ contentIds: [article.id] }, actor)).body.health[0].state, "ready");

    writeFileSync(fx.articleFile, "# Updated article\n\nA newly searchable recovery phrase.\n");
    const changed = (await fx.service.health({ contentIds: [article.id] }, actor)).body.health[0];
    assert.equal(changed.state, "changed");
    assert.equal(changed.canReveal, true);
    const container = await fx.service.resolveContainer({ contentId: article.id }, actor);
    assert.equal(container.ok, true);

    const refreshed = await fx.service.refresh({ contentId: article.id }, actor);
    assert.equal(refreshed.status, 200);
    assert.equal((await fx.service.search({ query: "recovery phrase" }, actor)).body.results[0].id, article.id);

    rmSync(fx.articleFile, { force: true });
    const missing = (await fx.service.health({ contentIds: [article.id] }, actor)).body.health[0];
    assert.equal(missing.state, "missing");
    assert.equal(missing.canReveal, true);
    await fx.service.refresh({ contentId: article.id }, actor);
    const indexedMissing = (await fx.service.search({ kinds: ["article"] }, actor)).body.results[0];
    assert.equal(indexedMissing.original.available, false);
  } finally {
    await fx.cleanup();
  }
});

test("known-original file events enqueue a narrow incremental refresh", async () => {
  const watched = [];
  const fx = fixture({
    watchOriginals: true,
    indexDebounceMs: 60_000,
    watchDirectory: (directory, _options, callback) => {
      const entry = { directory, callback, closed: false };
      watched.push(entry);
      return { on: () => {}, close: () => { entry.closed = true; } };
    },
  });
  try {
    await fx.service.rebuild({}, actor);
    const outputFile = join(fx.worktreeRoot, "deliverables", "quarterly-result.txt");
    writeFileSync(outputFile, "A filesystem watcher recovery phrase.\n");
    for (const entry of watched.filter((candidate) => !candidate.closed)) {
      entry.callback("change", "quarterly-result.txt");
    }
    await new Promise((resolvePromise) => setImmediate(resolvePromise));
    await fx.service.flushIncremental({}, actor);
    const result = await fx.service.search({ query: "watcher recovery", kinds: ["task_output"] }, actor);
    assert.equal(result.body.results.length, 1);
  } finally {
    await fx.cleanup();
  }
});

test("50,000-record lexical search stays within budget and directory paging reaches beyond 10,000", async () => {
  const state = {
    projects: [{ id: "scale_project", ownerTeamId: "scale_team", path: process.cwd(), name: "Scale" }],
    workItems: Array.from({ length: 50_000 }, (_value, index) => ({
      id: `scale_work_${index}`,
      ownerTeamId: "scale_team",
      projectId: "scale_project",
      localRef: `SCALE-${index}`,
      title: `Scale task ${index}`,
      body: index === 49_999 ? "unique scale search needle" : "ordinary scale content",
      createdAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
    })),
  };
  const service = createLocalContentCatalogService({
    state,
    stateStorePath: join(tmpdir(), "myagenttool-scale-state.json"),
    databasePath: ":memory:",
    now: () => "2026-08-14T03:00:00.000Z",
  });
  const scaleActor = { ...actor, teamId: "scale_team" };
  try {
    await service.rebuild({}, scaleActor);
    const durations = [];
    for (let index = 0; index < 20; index += 1) {
      const started = performance.now();
      const result = await service.search({ query: "unique scale search needle" }, scaleActor);
      durations.push(performance.now() - started);
      assert.equal(result.body.results.length, 1);
    }
    durations.sort((left, right) => left - right);
    assert.equal(durations[18] < 300, true, `search p95 was ${durations[18].toFixed(1)} ms`);
    const beyondLegacyCap = await service.search({ limit: 1, offset: 10_001 }, scaleActor);
    assert.equal(beyondLegacyCap.body.results.length, 1);
    const stats = await service.stats(scaleActor);
    assert.equal(stats.body.catalog.facets.workItems.length, 200);
    assert.deepEqual(stats.body.catalog.facets.coverage.workItems, { limit: 200, returned: 200, truncated: true });
  } finally {
    await service.close();
  }
});

test("local content routes bind bounded query parameters and rebuild requests", async () => {
  const sent = [];
  const captured = [];
  const res = {};
  const sendJson = (_res, status, body) => sent.push({ status, body });
  const searchHandled = await handleLocalContentRoutes({
    req: { method: "GET" },
    res,
    url: new URL("http://local/api/local-content?q=report&kind=article,task&limit=12&offset=3"),
    sendJson,
    readJson: async () => ({}),
    actor,
    searchLocalContent: async (input, routeActor) => {
      captured.push({ input, routeActor });
      return { status: 200, body: { results: [] } };
    },
  });
  assert.equal(searchHandled, true);
  assert.deepEqual(captured[0], {
    input: {
      query: "report",
      kinds: ["article", "task"],
      projectId: null,
      workItemId: null,
      sourceType: null,
      yearMonth: null,
      availability: null,
      indexStatus: null,
      mailAccountId: null,
      mailFolderId: null,
      limit: "12",
      offset: "3",
      cursor: null,
    },
    routeActor: actor,
  });
  assert.deepEqual(sent[0], { status: 200, body: { results: [] } });

  const directoryHandled = await handleLocalContentRoutes({
    req: { method: "GET" },
    res,
    url: new URL("http://local/api/local-content/directories?dimension=work_item&q=LOCAL&limit=15"),
    sendJson,
    readJson: async () => ({}),
    actor,
    browseLocalContentDirectories: async (input, routeActor) => {
      captured.push({ input, routeActor });
      return { status: 200, body: { entries: [] } };
    },
  });
  assert.equal(directoryHandled, true);
  assert.deepEqual(captured[1], {
    input: { dimension: "work_item", query: "LOCAL", limit: "15", cursor: null },
    routeActor: actor,
  });

  const rebuildHandled = await handleLocalContentRoutes({
    req: { method: "POST" },
    res,
    url: new URL("http://local/api/local-content/rebuild"),
    sendJson,
    readJson: async () => ({ reason: "manual_repair" }),
    actor,
    rebuildLocalContentCatalog: async (input, routeActor) => {
      captured.push({ input, routeActor });
      return { status: 200, body: { rebuild: { records: 5 } } };
    },
  });
  assert.equal(rebuildHandled, true);
  assert.deepEqual(captured[2], { input: { reason: "manual_repair" }, routeActor: actor });
  assert.deepEqual(sent[2], { status: 200, body: { rebuild: { records: 5 } } });

  const previewHandled = await handleLocalContentRoutes({
    req: { method: "GET" },
    res,
    url: new URL("http://local/api/local-content/lc_preview/preview"),
    sendJson,
    readJson: async () => ({}),
    actor,
    previewLocalContent: async (input, routeActor) => {
      captured.push({ input, routeActor });
      return { status: 200, body: { preview: { text: "safe" } } };
    },
  });
  assert.equal(previewHandled, true);
  assert.deepEqual(captured[3], { input: { contentId: "lc_preview" }, routeActor: actor });

  let assetRequest = null;
  let assetResponse = null;
  const assetHandled = await handleLocalContentRoutes({
    req: { method: "GET" },
    res: {
      writeHead: (status, headers) => { assetResponse = { status, headers, bytes: null }; },
      end: (bytes) => { assetResponse.bytes = bytes; },
    },
    url: new URL("http://local/api/local-content/lc_preview/asset?path=assets%2F001.png"),
    sendJson,
    readJson: async () => ({}),
    actor,
    previewLocalContentAsset: async (input, routeActor) => {
      assetRequest = { input, routeActor };
      return { status: 200, bytes: Buffer.from([1, 2, 3]), mimeType: "image/png", originalName: "001.png" };
    },
  });
  assert.equal(assetHandled, true);
  assert.deepEqual(assetRequest, {
    input: { contentId: "lc_preview", relativePath: "assets/001.png" },
    routeActor: actor,
  });
  assert.equal(assetResponse.status, 200);
  assert.equal(assetResponse.headers["Content-Type"], "image/png");
  assert.deepEqual(assetResponse.bytes, Buffer.from([1, 2, 3]));

  const healthHandled = await handleLocalContentRoutes({
    req: { method: "POST" },
    res,
    url: new URL("http://local/api/local-content/health"),
    sendJson,
    readJson: async () => ({ contentIds: ["lc_health"] }),
    actor,
    getLocalContentHealth: async (input, routeActor) => {
      captured.push({ input, routeActor });
      return { status: 200, body: { records: [{ contentId: "lc_health", status: "ready" }] } };
    },
  });
  assert.equal(healthHandled, true);
  assert.deepEqual(captured[4], { input: { contentIds: ["lc_health"] }, routeActor: actor });

  const refreshHandled = await handleLocalContentRoutes({
    req: { method: "POST" },
    res,
    url: new URL("http://local/api/local-content/lc_refresh/refresh"),
    sendJson,
    readJson: async () => ({}),
    actor,
    refreshLocalContent: async (input, routeActor) => {
      captured.push({ input, routeActor });
      return { status: 200, body: { content: { id: input.contentId } } };
    },
  });
  assert.equal(refreshHandled, true);
  assert.deepEqual(captured[5], { input: { contentId: "lc_refresh" }, routeActor: actor });

  let revealedTarget = null;
  const revealHandled = await handleLocalContentRoutes({
    req: { method: "POST" },
    res,
    url: new URL("http://local/api/local-content/lc_reveal/reveal"),
    sendJson,
    readJson: async () => ({}),
    actor,
    resolveLocalContentOriginal: async () => ({ ok: true, sourceType: "file", localPath: "C:\\private\\original.txt", originalName: "original.txt" }),
    revealLocalContentOriginal: async ({ target }) => { revealedTarget = target; },
  });
  assert.equal(revealHandled, true);
  assert.equal(revealedTarget, "C:\\private\\original.txt");
  assert.deepEqual(sent.at(-1), { status: 200, body: { revealed: true, name: "original.txt" } });
  assert.equal(JSON.stringify(sent.at(-1)).includes("C:\\private"), false);

  const revealContainerHandled = await handleLocalContentRoutes({
    req: { method: "POST" },
    res,
    url: new URL("http://local/api/local-content/lc_missing/reveal-container"),
    sendJson,
    readJson: async () => ({}),
    actor,
    resolveLocalContentContainer: async () => ({ ok: true, localPath: "C:\\private", originalName: "private" }),
    revealLocalContentOriginal: async ({ target }) => { revealedTarget = target; },
  });
  assert.equal(revealContainerHandled, true);
  assert.equal(revealedTarget, "C:\\private");
  assert.deepEqual(sent.at(-1), { status: 200, body: { revealed: true, name: "private" } });
  assert.equal(JSON.stringify(sent.at(-1)).includes("C:\\private"), false);

  const contractsHandled = await handleLocalContentRoutes({
    req: { method: "GET" },
    res,
    url: new URL("http://local/api/local-content/retrieval/contracts"),
    sendJson,
    readJson: async () => ({}),
    actor,
    describeLocalContentRetrieval: () => ({ status: 200, body: { version: "1.0.0", tools: [] } }),
  });
  assert.equal(contractsHandled, true);
  assert.deepEqual(sent.at(-1), { status: 200, body: { version: "1.0.0", tools: [] } });

  const retrievalBody = { invocationId: "inv_1", provider: "codex", query: "report" };
  const retrievalHandled = await handleLocalContentRoutes({
    req: { method: "POST" },
    res,
    url: new URL("http://local/api/local-content/retrieval/summaries"),
    sendJson,
    readJson: async () => retrievalBody,
    actor,
    retrieveLocalContentSummaries: async (input, routeActor) => {
      captured.push({ input, routeActor });
      return { status: 200, body: { candidates: [] } };
    },
  });
  assert.equal(retrievalHandled, true);
  assert.deepEqual(captured.at(-1), { input: retrievalBody, routeActor: actor });
  assert.deepEqual(sent.at(-1), { status: 200, body: { candidates: [] } });
});
