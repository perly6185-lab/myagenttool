import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPersistenceRuntime } from "../src/runtime/persistence.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";
import { sameProjectPath } from "../src/services/projects.mjs";
import { createMaterialWorkRetrievalService, MATERIAL_WORK_RETRIEVAL_LIMITS } from "../src/services/material-work-retrieval.mjs";
import { createMaterialWorkSessionService } from "../src/services/material-work-sessions.mjs";

const CONTENT_A = `lc_${"a".repeat(32)}`;
const CONTENT_B = `lc_${"b".repeat(32)}`;
const NOW = "2026-08-27T09:00:00.000Z";
const actorA = { userId: "usr_a", teamId: "team_a", role: "member" };
const actorB = { userId: "usr_b", teamId: "team_b", role: "member" };

function fixture({ readImpl = null, state = null } = {}) {
  const runtimeState = state ?? {
    materialWorkSessions: [],
    materialWorkMessages: [],
    materialWorkCitations: [],
    materialWorkReadReceipts: [],
  };
  let sequence = 0;
  const events = [];
  const versions = new Map([[CONTENT_A, "version-a-1"], [CONTENT_B, "version-b-1"]]);
  const records = new Map([
    [CONTENT_A, contentRecord(CONTENT_A, "客户反馈.txt")],
    [CONTENT_B, contentRecord(CONTENT_B, "内部计划.txt")],
  ]);
  const getLocalContent = async ({ contentId }, actor) => {
    const record = records.get(contentId);
    return record && actor?.teamId === "team_a"
      ? { status: 200, body: { content: { ...record, metadata: { sha256: versions.get(contentId) } } } }
      : { status: 404, body: { error: "local_content_not_found" } };
  };
  let cancelPending = () => ({ status: 200, body: { cancelled: 0 } });
  const sessions = createMaterialWorkSessionService({
    state: runtimeState,
    now: () => NOW,
    nextId: (prefix) => `${prefix}_${++sequence}`,
    persistStateSoon: () => {},
    appendEvent: (event) => events.push(event),
    getLocalContent,
    onCancelled: (input, actor) => cancelPending(input, actor),
    onRevisionAdvanced: (input, actor) => cancelPending(input, actor),
  });
  const retrieval = createMaterialWorkRetrievalService({
    state: runtimeState,
    now: () => NOW,
    nextId: (prefix) => `${prefix}_${++sequence}`,
    persistStateSoon: () => {},
    appendEvent: (event) => events.push(event),
    resolveOwnedSession: sessions.resolveOwnedSession,
    getLocalContent,
    readLocalContentText: readImpl ?? (async ({ contentId, offset, limit }) => {
      const source = contentId === CONTENT_A ? "客户希望缩短交付时间。" : "只供内部使用。";
      const text = Array.from(source).slice(offset, offset + limit).join("");
      const nextOffset = offset + Array.from(text).length;
      return { status: 200, body: { chunk: {
        contentId, offset, text, nextOffset: nextOffset < Array.from(source).length ? nextOffset : null,
        eof: nextOffset >= Array.from(source).length, sourceTruncated: false, continuationUnavailable: false,
      } } };
    }),
  });
  cancelPending = retrieval.cancelPending;
  return { state: runtimeState, sessions, retrieval, versions, events };
}

function contentRecord(id, title) {
  return {
    id,
    kind: "material",
    title,
    projectId: "project_a",
    workItemId: null,
    mimeType: "text/plain",
    source: { type: "channel_attachment_import" },
    sourceLabel: "Channel 附件",
    modifiedAt: NOW,
    original: { available: true, reason: null },
    indexStatus: "ready",
  };
}

async function createRound(fx, contentIds = [CONTENT_A]) {
  const created = await fx.sessions.createSession({
    userGoal: "总结资料",
    scope: { mode: "selected", contentIds },
  }, actorA);
  assert.equal(created.status, 201);
  return {
    sessionId: created.body.session.id,
    messageId: created.body.messages[0].id,
    expectedRevision: created.body.session.revision,
  };
}

test("reads only selected material and stores a path-free evidence receipt", async () => {
  const fx = fixture();
  const round = await createRound(fx);
  const result = await fx.retrieval.read({ ...round, contentId: CONTENT_A, offset: 0, limit: 8_192 }, actorA);

  assert.equal(result.status, 200);
  assert.equal(result.body.chunk.text, "客户希望缩短交付时间。");
  assert.equal(result.body.trust, "untrusted_reference");
  assert.equal(result.body.receipt.coordinateUnit, "chunk_unicode_code_point");
  assert.equal(result.body.receipt.sourceVersion, "version-a-1");
  assert.equal(result.body.budget.readsUsed, 1);
  assert.equal(fx.state.materialWorkReadReceipts[0].status, "completed");
  assert.match(fx.state.materialWorkReadReceipts[0].textHash, /^[a-f0-9]{64}$/);
  assert.equal("textHash" in result.body.receipt, false);
  assert.equal(JSON.stringify(result.body).includes("/private/"), false);
  assert.equal(fx.events.some((event) => event.type === "material_work_read_completed"), true);
});

test("scope, message, user, and team ownership fail closed", async () => {
  const fx = fixture();
  const round = await createRound(fx, [CONTENT_A]);

  assert.equal((await fx.retrieval.read({ ...round, contentId: CONTENT_B }, actorA)).status, 404);
  assert.equal((await fx.retrieval.read({ ...round, contentId: CONTENT_A }, actorB)).status, 404);
  assert.equal((await fx.retrieval.read({ ...round, messageId: "material_work_message_fake", contentId: CONTENT_A }, actorA)).status, 404);
  assert.equal((await fx.retrieval.read({ ...round, expectedRevision: 99, contentId: CONTENT_A }, actorA)).body.error, "material_work_revision_conflict");
  assert.equal(fx.state.materialWorkReadReceipts.length, 0);
});

test("durable per-round read budgets cannot be reset by recreating the service", async () => {
  const fx = fixture();
  const round = await createRound(fx);
  for (let index = 0; index < MATERIAL_WORK_RETRIEVAL_LIMITS.maxReadsPerRound; index += 1) {
    const result = await fx.retrieval.read({ ...round, contentId: CONTENT_A, offset: 0, limit: 1 }, actorA);
    assert.equal(result.status, 200);
  }
  const restarted = fixture({ state: JSON.parse(JSON.stringify(fx.state)) });
  const refused = await restarted.retrieval.read({ ...round, contentId: CONTENT_A, offset: 0, limit: 1 }, actorA);
  assert.equal(refused.status, 429);
  assert.equal(refused.body.error, "material_work_read_limit_exceeded");
  assert.equal(refused.body.budget.readsRemaining, 0);
});

test("character reservations enforce the shared bounded-reader limits", async () => {
  const text = "甲".repeat(MATERIAL_WORK_RETRIEVAL_LIMITS.maxChunkCharacters);
  const fx = fixture({
    readImpl: async ({ contentId, offset }) => ({ status: 200, body: { chunk: {
      contentId, offset, text, nextOffset: offset + text.length, eof: false,
      sourceTruncated: false, continuationUnavailable: false,
    } } }),
  });
  const round = await createRound(fx);
  for (let index = 0; index < 4; index += 1) {
    const result = await fx.retrieval.read({
      ...round,
      contentId: CONTENT_A,
      offset: index * text.length,
      limit: MATERIAL_WORK_RETRIEVAL_LIMITS.maxChunkCharacters * 2,
    }, actorA);
    assert.equal(result.status, 200);
    assert.equal(result.body.receipt.charactersRead, MATERIAL_WORK_RETRIEVAL_LIMITS.maxChunkCharacters);
  }
  const refused = await fx.retrieval.read({ ...round, contentId: CONTENT_A, offset: 0, limit: 1 }, actorA);
  assert.equal(refused.status, 429);
  assert.equal(refused.body.error, "material_work_character_limit_exceeded");
});

test("concurrent reads reserve the character budget before asynchronous I/O", async () => {
  const releases = [];
  let allStarted;
  const allStartedPromise = new Promise((resolve) => { allStarted = resolve; });
  const fx = fixture({
    readImpl: ({ contentId, offset, limit }) => new Promise((resolve) => {
      releases.push(() => resolve({ status: 200, body: { chunk: {
        contentId, offset, text: "甲".repeat(limit), nextOffset: offset + limit, eof: false,
        sourceTruncated: false, continuationUnavailable: false,
      } } }));
      if (releases.length === 4) allStarted();
    }),
  });
  const round = await createRound(fx);
  const reads = Array.from({ length: 4 }, (_, index) => fx.retrieval.read({
    ...round,
    contentId: CONTENT_A,
    offset: index * MATERIAL_WORK_RETRIEVAL_LIMITS.maxChunkCharacters,
    limit: MATERIAL_WORK_RETRIEVAL_LIMITS.maxChunkCharacters,
  }, actorA));
  const refused = await fx.retrieval.read({ ...round, contentId: CONTENT_A, offset: 0, limit: 1 }, actorA);
  assert.equal(refused.status, 429);
  assert.equal(refused.body.error, "material_work_character_limit_exceeded");
  assert.equal(fx.state.materialWorkReadReceipts.filter((receipt) => receipt.status === "reading").length, 4);
  await allStartedPromise;
  for (const release of releases) release();
  assert.equal((await Promise.all(reads)).every((result) => result.status === 200), true);
});

test("source changes before or during a read return no material text", async () => {
  const before = fixture();
  const beforeRound = await createRound(before);
  before.versions.set(CONTENT_A, "version-a-2");
  const changedBefore = await before.retrieval.read({ ...beforeRound, contentId: CONTENT_A }, actorA);
  assert.equal(changedBefore.status, 409);
  assert.equal(changedBefore.body.error, "material_work_source_changed");
  assert.equal(before.state.materialWorkReadReceipts[0].status, "source_changed");

  let during;
  during = fixture({
    readImpl: async ({ contentId, offset }) => {
      during.versions.set(CONTENT_A, "version-a-3");
      return { status: 200, body: { chunk: {
        contentId, offset, text: "不应返回", nextOffset: null, eof: true,
        sourceTruncated: false, continuationUnavailable: false,
      } } };
    },
  });
  const duringRound = await createRound(during);
  const changedDuring = await during.retrieval.read({ ...duringRound, contentId: CONTENT_A }, actorA);
  assert.equal(changedDuring.status, 409);
  assert.equal(changedDuring.body.error, "material_work_source_changed");
  assert.equal(JSON.stringify(changedDuring.body).includes("不应返回"), false);
  assert.equal(during.state.materialWorkReadReceipts[0].status, "source_changed");
});

test("session cancellation aborts pending reads and prevents a completed receipt", async () => {
  let releaseRead;
  let started;
  const startedPromise = new Promise((resolve) => { started = resolve; });
  const fx = fixture({
    readImpl: ({ contentId, offset, signal }) => new Promise((resolve) => {
      started(signal);
      releaseRead = () => resolve({ status: 200, body: { chunk: {
        contentId, offset, text: "取消后不可采用", nextOffset: null, eof: true,
        sourceTruncated: false, continuationUnavailable: false,
      } } });
    }),
  });
  const round = await createRound(fx);
  const reading = fx.retrieval.read({ ...round, contentId: CONTENT_A }, actorA);
  const signal = await startedPromise;
  const cancelled = fx.sessions.cancelSession({ sessionId: round.sessionId, expectedRevision: 1 }, actorA);
  assert.equal(cancelled.status, 200);
  assert.equal(signal.aborted, true);
  releaseRead();
  const result = await reading;
  assert.equal(result.status, 409);
  assert.equal(result.body.error, "material_work_read_cancelled");
  assert.equal(fx.state.materialWorkReadReceipts[0].status, "cancelled");
  assert.equal(fx.state.materialWorkReadReceipts.some((receipt) => receipt.status === "completed"), false);
  const receiptCount = fx.state.materialWorkReadReceipts.length;
  const refused = await fx.retrieval.read({ ...round, contentId: CONTENT_A }, actorA);
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, "material_work_session_cancelled");
  assert.equal(fx.state.materialWorkReadReceipts.length, receiptCount);
});

test("a new user-message revision aborts reads from the previous round", async () => {
  let releaseRead;
  let started;
  const startedPromise = new Promise((resolve) => { started = resolve; });
  const fx = fixture({
    readImpl: ({ contentId, offset, signal }) => new Promise((resolve) => {
      started(signal);
      releaseRead = () => resolve({ status: 200, body: { chunk: {
        contentId, offset, text: "旧一轮内容", nextOffset: null, eof: true,
        sourceTruncated: false, continuationUnavailable: false,
      } } });
    }),
  });
  const round = await createRound(fx);
  const reading = fx.retrieval.read({ ...round, contentId: CONTENT_A }, actorA);
  const signal = await startedPromise;
  const next = await fx.sessions.addMessage({
    sessionId: round.sessionId,
    content: "换一个问题",
    expectedRevision: 1,
  }, actorA);
  assert.equal(next.status, 202);
  assert.equal(next.body.session.revision, 2);
  assert.equal(signal.aborted, true);
  releaseRead();
  const result = await reading;
  assert.equal(result.status, 409);
  assert.equal(result.body.error, "material_work_read_cancelled");
  assert.equal(fx.state.materialWorkReadReceipts[0].status, "cancelled");
});

test("startup turns an unfinished durable reservation into an interrupted receipt", () => {
  const state = {
    materialWorkSessions: [], materialWorkMessages: [], materialWorkCitations: [],
    materialWorkReadReceipts: [{
      id: "material_work_read_interrupted", status: "reading", reservedCharacters: 8_192,
      sessionId: "material_work_session_old", messageId: "material_work_message_old",
      ownerTeamId: "team_a", contentId: CONTENT_A, retrievalRevision: 1,
    }],
  };
  const fx = fixture({ state });
  assert.equal(fx.state.materialWorkReadReceipts[0].status, "interrupted");
  assert.equal(fx.state.materialWorkReadReceipts[0].reservedCharacters, 0);
  assert.equal(fx.events.some((event) => event.type === "material_work_read_interrupted"), true);
});

test("a completed read receipt survives the real JSON persistence boundary", async () => {
  const root = mkdtempSync(join(tmpdir(), "myagenttool-material-read-json-"));
  const projectPath = join(root, "project");
  const stateStorePath = join(root, "state", "snapshot.json");
  mkdirSync(projectPath, { recursive: true });
  try {
    const first = createServerState({ defaultProjectPath: projectPath, now: () => NOW });
    const fx = fixture({ state: first.state });
    const round = await createRound(fx);
    assert.equal((await fx.retrieval.read({ ...round, contentId: CONTENT_A }, actorA)).status, 200);
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
    const restored = fixture({ state: restarted.state });
    const listed = restored.retrieval.listReceipts({ sessionId: round.sessionId }, actorA);
    assert.equal(listed.status, 200);
    assert.equal(listed.body.receipts.length, 1);
    assert.equal(listed.body.receipts[0].status, "completed");
    assert.equal(restarted.state.materialWorkReadReceipts[0].textHash, fx.state.materialWorkReadReceipts[0].textHash);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
