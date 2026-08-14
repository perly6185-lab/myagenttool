import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  createLocalContentCatalogService,
  localContentCatalogPath,
} from "../src/services/local-content-catalog.mjs";
import { handleLocalContentRoutes } from "../src/routes/local-content.mjs";

const actor = { userId: "usr_1", teamId: "team_1", role: "owner" };

function fixture() {
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
  const inputRelativePath = join("task-materials", "team_1", "prj_1", "tmd_1", inputStoredName);
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
      { id: "mail_app", ownerTeamId: "team_1" },
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
    input: { query: "report", kinds: ["article", "task"], projectId: null, limit: "12", offset: "3" },
    routeActor: actor,
  });
  assert.deepEqual(sent[0], { status: 200, body: { results: [] } });

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
  assert.deepEqual(captured[1], { input: { reason: "manual_repair" }, routeActor: actor });
  assert.deepEqual(sent[1], { status: 200, body: { rebuild: { records: 5 } } });
});
