import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createServerState } from "../../src/runtime/state-factory.mjs";
import { createServerRuntimeServices } from "../../src/runtime/service-composer.mjs";
import { createHttpServer } from "../../src/runtime/http-server.mjs";

const NOW = "2026-08-27T08:00:00.000Z";
let root;
let server;
let base;
let runtime;
let state;

before(async () => {
  root = mkdtempSync(join(tmpdir(), "myagenttool-material-work-http-"));
  const projectAPath = join(root, "project-a");
  const projectBPath = join(root, "project-b");
  const stateStorePath = join(root, "state", "local.json");
  mkdirSync(projectAPath, { recursive: true });
  mkdirSync(projectBPath, { recursive: true });
  mkdirSync(join(root, "state"), { recursive: true });
  const seeded = createServerState({ defaultProjectPath: projectAPath, now: () => NOW });
  state = seeded.state;
  state.teams.push({ id: "team_a" }, { id: "team_b" });
  state.users.push({ id: "usr_a", teamId: "team_a" }, { id: "usr_b", teamId: "team_b" });
  state.tokens.push(
    { token: "token_a", userId: "usr_a", expiresAt: "2099-01-01T00:00:00.000Z" },
    { token: "token_b", userId: "usr_b", expiresAt: "2099-01-01T00:00:00.000Z" },
  );
  state.projects.push(
    { id: "project_a", name: "A", ownerTeamId: "team_a", path: projectAPath, status: "active" },
    { id: "project_b", name: "B", ownerTeamId: "team_b", path: projectBPath, status: "active" },
  );
  state.workItems.push(
    {
      id: "work_a", localRef: "LOCAL-A", ownerTeamId: "team_a", projectId: "project_a",
      title: "客户反馈", body: "客户希望缩短交付时间。", type: "task", status: "ready",
      inputAssets: [], outputAssets: [], localContentRefs: [], createdAt: NOW, updatedAt: NOW,
    },
    {
      id: "work_b", localRef: "LOCAL-B", ownerTeamId: "team_b", projectId: "project_b",
      title: "其他团队资料", body: "这份内容不应被 A 团队读取。", type: "task", status: "ready",
      inputAssets: [], outputAssets: [], localContentRefs: [], createdAt: NOW, updatedAt: NOW,
    },
  );
  runtime = createServerRuntimeServices({
    namespace: "test",
    protocolVersion: "0.0.0",
    state,
    defaultProject: seeded.defaultProject,
    defaultProjectPath: projectAPath,
    persistenceEnabled: false,
    stateStorePath,
    stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000,
    now: () => NOW,
  });
  await runtime.startLocalContentIndexing();
  await runtime.flushLocalContentIndexing();
  server = createHttpServer({
    host: "127.0.0.1",
    port: 0,
    namespace: "test",
    protocolVersion: "0.0.0",
    ...runtime.httpDependencies,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server?.close(resolve) ?? resolve());
  await runtime?.closeRuntimeServices();
  rmSync(root, { recursive: true, force: true });
});

async function call(path, { token = "token_a", method = "GET", body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

test("real HTTP creates, restores, revises, and cancels a selected material session", async () => {
  const catalog = await call("/api/local-content?q=%E5%AE%A2%E6%88%B7%E5%8F%8D%E9%A6%88&kind=task");
  assert.equal(catalog.status, 200);
  const content = catalog.body.results.find((item) => item.workItemId === "work_a");
  assert.ok(content, JSON.stringify(catalog.body));

  const created = await call("/api/material-work-sessions", {
    method: "POST",
    body: {
      userGoal: "总结客户反馈",
      scope: { mode: "selected", contentIds: [content.id] },
      entryPoint: "local_library",
      idempotencyKey: "http-create-1",
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.session.status, "draft");
  assert.equal(created.body.session.scope.items[0].contentId, content.id);
  assert.equal(state.materialWorkSessions.length, 1);
  assert.equal(state.materialWorkMessages.length, 1);

  const sessionId = created.body.session.id;
  const read = await runtime.materialWorkRetrieval.read({
    sessionId,
    messageId: created.body.messages[0].id,
    contentId: content.id,
    expectedRevision: 1,
    offset: 0,
    limit: 8_192,
  }, { userId: "usr_a", teamId: "team_a", role: "member" });
  assert.equal(read.status, 200);
  assert.match(read.body.chunk.text, /客户希望缩短交付时间/);
  assert.equal(read.body.receipt.status, "completed");
  assert.equal(state.materialWorkReadReceipts.length, 1);

  const restored = await call(`/api/material-work-sessions/${sessionId}`);
  assert.equal(restored.status, 200);
  assert.equal(restored.body.messages[0].content, "总结客户反馈");
  assert.equal((await call(`/api/material-work-sessions/${sessionId}`, { token: "token_b" })).status, 404);

  const message = await call(`/api/material-work-sessions/${sessionId}/messages`, {
    method: "POST",
    body: { content: "重点是什么？", expectedRevision: 1, idempotencyKey: "http-message-1" },
  });
  assert.equal(message.status, 202);
  assert.equal(message.body.session.revision, 2);
  assert.equal(message.body.session.generation.available, false);
  assert.equal(message.body.generation.reason, "material_work_generation_not_enabled");

  const stale = await call(`/api/material-work-sessions/${sessionId}/messages`, {
    method: "POST",
    body: { content: "过期消息", expectedRevision: 1 },
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.currentRevision, 2);

  const cancelled = await call(`/api/material-work-sessions/${sessionId}/cancel`, {
    method: "POST",
    body: { expectedRevision: 2, idempotencyKey: "http-cancel-1" },
  });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.session.status, "cancelled");
  assert.equal(cancelled.body.session.revision, 3);
});

test("real HTTP cannot inject another team content identity into a material session", async () => {
  const foreignCatalog = await call("/api/local-content?q=%E5%85%B6%E4%BB%96%E5%9B%A2%E9%98%9F%E8%B5%84%E6%96%99&kind=task", { token: "token_b" });
  const foreign = foreignCatalog.body.results.find((item) => item.workItemId === "work_b");
  assert.ok(foreign, JSON.stringify(foreignCatalog.body));

  const refused = await call("/api/material-work-sessions", {
    method: "POST",
    body: {
      userGoal: "读取其他团队资料",
      scope: { mode: "selected", contentIds: [foreign.id] },
    },
  });
  assert.equal(refused.status, 404);
  assert.equal(refused.body.error, "material_work_content_not_found");
});
