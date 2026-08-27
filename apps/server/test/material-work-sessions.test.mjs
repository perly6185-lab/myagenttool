import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPersistenceRuntime } from "../src/runtime/persistence.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";
import { sameProjectPath } from "../src/services/projects.mjs";
import { createMaterialWorkSessionService } from "../src/services/material-work-sessions.mjs";

const CONTENT_A = `lc_${"a".repeat(32)}`;
const CONTENT_B = `lc_${"b".repeat(32)}`;
const CONTENT_FOREIGN = `lc_${"f".repeat(32)}`;
const NOW = "2026-08-27T08:00:00.000Z";
const actorA = { userId: "usr_a", teamId: "team_a", role: "member" };
const actorB = { userId: "usr_b", teamId: "team_b", role: "member" };

function fixture({ state = null, deterministicResponder = null } = {}) {
  const runtimeState = state ?? { materialWorkSessions: [], materialWorkMessages: [], materialWorkCitations: [] };
  let sequence = 0;
  const events = [];
  const records = new Map([
    [CONTENT_A, contentRecord(CONTENT_A, "team_a", "客户反馈.txt", "material")],
    [CONTENT_B, contentRecord(CONTENT_B, "team_a", "报价方案.docx", "task_input")],
    [CONTENT_FOREIGN, contentRecord(CONTENT_FOREIGN, "team_b", "其他团队.txt", "material")],
  ]);
  const service = createMaterialWorkSessionService({
    state: runtimeState,
    now: () => NOW,
    nextId: (prefix) => `${prefix}_${++sequence}`,
    persistStateSoon: () => {},
    appendEvent: (event) => events.push(event),
    deterministicResponder,
    getLocalContent: async ({ contentId }, actor) => {
      const record = records.get(contentId);
      return record && record.ownerTeamId === actor?.teamId
        ? { status: 200, body: { content: record.content } }
        : { status: 404, body: { error: "local_content_not_found" } };
    },
  });
  return { service, state: runtimeState, events };
}

function contentRecord(id, ownerTeamId, title, kind) {
  return {
    ownerTeamId,
    content: {
      id,
      kind,
      title,
      summary: "不应复制进会话的长摘要",
      projectId: "project_a",
      workItemId: null,
      root: { kind: "application_data", id: "private-root" },
      relativePath: "/private/path/never-expose.txt",
      mimeType: "text/plain",
      source: { type: "channel_attachment_import", id: "private-source-id" },
      sourceLabel: "Channel 附件",
      modifiedAt: "2026-08-27T07:00:00.000Z",
      original: { available: true, reason: null },
      indexStatus: "ready",
      metadata: { sha256: `sha256:${id.slice(3).padEnd(64, "0")}` },
    },
  };
}

test("selected material sessions freeze a safe user-owned scope and survive plain-state restart", async () => {
  const fx = fixture();
  const created = await fx.service.createSession({
    userGoal: "总结客户反馈",
    scope: { mode: "selected", contentIds: [CONTENT_A, CONTENT_B, CONTENT_A] },
    entryPoint: "local_library",
    idempotencyKey: "create-a",
  }, actorA);

  assert.equal(created.status, 201);
  assert.equal(created.body.session.status, "draft");
  assert.equal(created.body.session.revision, 1);
  assert.deepEqual(created.body.session.scope.items.map((item) => item.contentId), [CONTENT_A, CONTENT_B]);
  assert.equal(created.body.session.scope.immutable, true);
  assert.match(created.body.session.scope.fingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.equal(created.body.messages.length, 1);
  assert.equal(created.body.messages[0].kind, "goal");
  assert.equal(JSON.stringify(created.body).includes("/private/path"), false);
  assert.equal(JSON.stringify(created.body).includes("private-source-id"), false);
  assert.equal(fx.service.getSession({ sessionId: created.body.session.id }, actorB).status, 404);

  const replay = await fx.service.createSession({
    userGoal: "总结客户反馈",
    scope: { mode: "selected", contentIds: [CONTENT_A, CONTENT_B] },
    entryPoint: "local_library",
    idempotencyKey: "create-a",
  }, actorA);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.deduplicated, true);
  assert.equal(fx.state.materialWorkSessions.length, 1);

  const restoredState = JSON.parse(JSON.stringify(fx.state));
  const restarted = fixture({ state: restoredState });
  const recovered = restarted.service.getSession({ sessionId: created.body.session.id }, actorA);
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.session.scope.fingerprint, created.body.session.scope.fingerprint);
  assert.equal(recovered.body.messages[0].content, "总结客户反馈");
});

test("sessions, messages, and citations survive the real JSON persistence boundary", async () => {
  const root = mkdtempSync(join(tmpdir(), "myagenttool-material-work-persistence-"));
  const projectPath = join(root, "project");
  const stateStorePath = join(root, "state", "snapshot.json");
  mkdirSync(projectPath, { recursive: true });
  try {
    const first = createServerState({ defaultProjectPath: projectPath, now: () => NOW });
    const createdBy = fixture({
      state: first.state,
      deterministicResponder: async () => ({
        answer: "持久化回答",
        citations: [{ contentId: CONTENT_A, excerpt: "持久化引用" }],
      }),
    });
    const created = await createdBy.service.createSession({
      userGoal: "持久化这次资料工作",
      scope: { mode: "selected", contentIds: [CONTENT_A] },
    }, actorA);
    const answered = await createdBy.service.addMessage({
      sessionId: created.body.session.id,
      content: "给我回答",
      expectedRevision: 1,
    }, actorA);
    assert.equal(answered.status, 200);
    const persistence = createPersistenceRuntime({
      state: first.state,
      enabled: true,
      stateStorePath,
      schemaVersion: 1,
      now: () => NOW,
      defaultProject: first.defaultProject,
      sameProjectPath,
    });
    assert.equal(persistence.persistStateNow().ok, true);

    const restarted = createServerState({ defaultProjectPath: projectPath, now: () => NOW });
    createPersistenceRuntime({
      state: restarted.state,
      enabled: true,
      stateStorePath,
      schemaVersion: 1,
      now: () => NOW,
      defaultProject: restarted.defaultProject,
      sameProjectPath,
    }).restorePersistentState();
    const restoredService = fixture({ state: restarted.state }).service;
    const restored = restoredService.getSession({ sessionId: created.body.session.id }, actorA);
    assert.equal(restored.status, 200);
    assert.equal(restored.body.messages[0].content, "持久化这次资料工作");
    assert.equal(restored.body.messages.at(-1).content, "持久化回答");
    assert.equal(restored.body.citations[0].excerpt, "持久化引用");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scope creation fails closed for malformed and cross-team content identities", async () => {
  const fx = fixture();
  assert.equal((await fx.service.createSession({
    userGoal: "不能扩展范围", scope: { mode: "all", contentIds: [CONTENT_A] },
  }, actorA)).body.error, "material_work_scope_mode_unsupported");
  assert.equal((await fx.service.createSession({
    userGoal: "读取越权资料", scope: { mode: "selected", contentIds: [CONTENT_FOREIGN] },
  }, actorA)).status, 404);
  assert.equal((await fx.service.createSession({
    userGoal: "读取错误资料", scope: { mode: "selected", contentIds: ["../../secret"] },
  }, actorA)).body.error, "material_work_content_id_invalid");
  assert.equal((await fx.service.createSession({
    userGoal: "没有资料", scope: { mode: "selected", contentIds: [] },
  }, actorA)).body.error, "material_work_selected_content_required");
  assert.equal(fx.state.materialWorkSessions.length, 0);
});

test("authentication and Channel source context fail closed when ownership evidence is incomplete", async () => {
  const fx = fixture();
  assert.equal((await fx.service.createSession({
    userGoal: "缺少团队", scope: { mode: "selected", contentIds: [CONTENT_A] },
  }, { userId: "usr_a" })).status, 401);
  const incompleteChannel = await fx.service.createFromChannel({
    userGoal: "使用附件",
    references: [{ contentId: CONTENT_A }],
    channelId: "channel_1",
    conversationId: "conversation_1",
  }, actorA);
  assert.equal(incompleteChannel.status, 400);
  assert.equal(incompleteChannel.body.error, "material_work_channel_context_required");
});

test("messages use optimistic revisions and cancellation prevents later work", async () => {
  const fx = fixture();
  const created = await fx.service.createSession({
    userGoal: "看懂资料",
    scope: { mode: "selected", contentIds: [CONTENT_A] },
  }, actorA);
  const sessionId = created.body.session.id;
  const initialFingerprint = created.body.session.scope.fingerprint;

  const accepted = await fx.service.addMessage({
    sessionId,
    content: "重点是什么？",
    expectedRevision: 1,
    idempotencyKey: "message-1",
  }, actorA);
  assert.equal(accepted.status, 202);
  assert.equal(accepted.body.session.status, "draft");
  assert.equal(accepted.body.session.revision, 2);
  assert.equal(accepted.body.generation.reason, "material_work_generation_not_enabled");
  assert.equal(accepted.body.session.scope.fingerprint, initialFingerprint);
  assert.equal(accepted.body.messages.length, 2);

  const replay = await fx.service.addMessage({
    sessionId,
    content: "重点是什么？",
    expectedRevision: 1,
    idempotencyKey: "message-1",
  }, actorA);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.deduplicated, true);
  assert.equal(replay.body.session.revision, 2);
  assert.equal((await fx.service.addMessage({
    sessionId, content: "过期修改", expectedRevision: 1,
  }, actorA)).body.error, "material_work_revision_conflict");

  const cancelled = fx.service.cancelSession({
    sessionId,
    expectedRevision: 2,
    idempotencyKey: "cancel-1",
  }, actorA);
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.session.status, "cancelled");
  assert.equal(cancelled.body.session.revision, 3);
  assert.equal((await fx.service.addMessage({
    sessionId, content: "取消后继续", expectedRevision: 3,
  }, actorA)).body.error, "material_work_session_cancelled");
});

test("the deterministic fixture exercises completion and citation scope without enabling production generation", async () => {
  const fx = fixture({
    deterministicResponder: async ({ scope }) => ({
      answer: "客户希望缩短交付时间。",
      citations: [{
        contentId: scope.items[0].contentId,
        sourceFingerprint: scope.items[0].selectedVersion,
        plainTextOffset: 0,
        excerpt: "客户希望缩短交付时间",
      }],
    }),
  });
  const created = await fx.service.createSession({
    userGoal: "总结资料", scope: { mode: "selected", contentIds: [CONTENT_A] },
  }, actorA);
  const completed = await fx.service.addMessage({
    sessionId: created.body.session.id,
    content: "给我一句结论",
    expectedRevision: 1,
  }, actorA);

  assert.equal(completed.status, 200);
  assert.equal(completed.body.session.status, "completed");
  assert.equal(completed.body.session.revision, 3);
  assert.equal(completed.body.messages.at(-1).role, "assistant");
  assert.equal(completed.body.citations.length, 1);
  assert.equal(completed.body.citations[0].contentId, CONTENT_A);
  assert.equal(fx.events.some((event) => event.type === "material_work_session_completed"), true);
});

test("the deterministic fixture rejects a citation pinned to a different source version", async () => {
  const fx = fixture({
    deterministicResponder: async () => ({
      answer: "不应接受这条回答",
      citations: [{ contentId: CONTENT_A, sourceFingerprint: "stale-version", excerpt: "旧内容" }],
    }),
  });
  const created = await fx.service.createSession({
    userGoal: "核验版本", scope: { mode: "selected", contentIds: [CONTENT_A] },
  }, actorA);
  const failed = await fx.service.addMessage({
    sessionId: created.body.session.id,
    content: "回答",
    expectedRevision: 1,
  }, actorA);
  assert.equal(failed.status, 500);
  assert.equal(failed.body.error, "material_work_fixture_citation_version_mismatch");
  assert.equal(fx.state.materialWorkCitations.length, 0);
});

test("Channel attachment references become the same immutable selected scope", async () => {
  const fx = fixture();
  const created = await fx.service.createFromChannel({
    userGoal: "比较刚才两份资料",
    references: [{ contentId: CONTENT_A }, { contentId: CONTENT_B }],
    channelId: "channel_1",
    conversationId: "conversation_1",
    eventId: "event_1",
  }, actorA);

  assert.equal(created.status, 201);
  assert.equal(created.body.session.sourceContext.kind, "channel");
  assert.equal(created.body.session.sourceContext.eventId, "event_1");
  assert.deepEqual(created.body.session.scope.items.map((item) => item.contentId), [CONTENT_A, CONTENT_B]);
  const replay = await fx.service.createFromChannel({
    userGoal: "比较刚才两份资料",
    references: [{ contentId: CONTENT_A }, { contentId: CONTENT_B }],
    channelId: "channel_1",
    conversationId: "conversation_1",
    eventId: "event_1",
  }, actorA);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.deduplicated, true);
});
