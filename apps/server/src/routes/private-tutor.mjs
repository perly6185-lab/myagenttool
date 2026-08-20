import { createHash } from "node:crypto";
import { hashPassword, verifyPassword } from "../runtime/auth.mjs";

const LOCAL_TEAM_ID = "team_local";
const LOCAL_USER_ID = "usr_local";
const MAX_NAME_LENGTH = 40;
const MAX_GRADE_LENGTH = 40;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const KNOWLEDGE_IDS = new Set(["integer", "equation-meaning", "balance", "word-problem"]);
const ATTEMPT_SOURCES = new Set(["screen", "voice_confirmed", "visual"]);
const EXIT_PIN_PATTERN = /^\d{6,12}$/;
const EXIT_FAILURE_LIMIT = 5;
const EXIT_LOCK_MS = 5 * 60 * 1000;

export async function handlePrivateTutorRoutes({
  req,
  res,
  url,
  sendJson,
  readJson,
  state,
  actor,
  now,
  nextId,
  persistStateSoon,
}) {
  if (!url.pathname.startsWith("/api/private-tutor/")) return false;
  ensureCollections(state);

  if (url.pathname === "/api/private-tutor/child-mode") {
    if (req.method === "GET") {
      sendJson(res, 200, childModeView(actor));
      return true;
    }
    if (req.method === "POST") {
      if (!actor?.sessionId) {
        sendJson(res, 409, { error: "private_tutor_browser_session_required" });
        return true;
      }
      if (actor.privateTutorLearnerId) {
        sendJson(res, 409, { error: "private_tutor_child_mode_already_active" });
        return true;
      }
      const body = await readJson(req).catch(() => ({}));
      const learnerId = String(body?.learnerId ?? "").trim();
      const exitPin = String(body?.exitPin ?? "");
      const learner = findAuthorizedLearner(state, actor, learnerId);
      if (!learner) {
        sendJson(res, 404, learnerNotFound());
        return true;
      }
      if (!EXIT_PIN_PATTERN.test(exitPin)) {
        sendJson(res, 400, { error: "invalid_private_tutor_parent_pin", message: "Use a 6-12 digit parent PIN." });
        return true;
      }
      const session = state.identitySessions.find((row) => row.id === actor.sessionId && !row.revokedAt);
      if (!session) {
        sendJson(res, 409, { error: "private_tutor_browser_session_required" });
        return true;
      }
      const enteredAt = now();
      session.privateTutorChildMode = {
        learnerId: learner.id,
        exitPinHash: hashPassword(exitPin),
        enteredAt,
        failedExitAttempts: 0,
        lockedUntil: null,
      };
      recordAudit(state, {
        learner,
        actor,
        action: "child_mode_entered",
        details: { sessionId: session.id },
        now,
        nextId,
      });
      persistStateSoon();
      sendJson(res, 201, { active: true, learnerId: learner.id, enteredAt });
      return true;
    }
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  if (url.pathname === "/api/private-tutor/child-mode/exit") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const session = state.identitySessions.find((row) => row.id === actor?.sessionId && !row.revokedAt);
    const childMode = session?.privateTutorChildMode;
    if (!session || !childMode) {
      sendJson(res, 409, { error: "private_tutor_child_mode_not_active" });
      return true;
    }
    const nowMs = Date.parse(now());
    if (childMode.lockedUntil && Date.parse(childMode.lockedUntil) > nowMs) {
      const retryAfterSeconds = Math.ceil((Date.parse(childMode.lockedUntil) - nowMs) / 1000);
      res.setHeader("Retry-After", String(retryAfterSeconds));
      sendJson(res, 429, { error: "private_tutor_parent_reverification_locked", retryAfterSeconds });
      return true;
    }
    const body = await readJson(req).catch(() => ({}));
    const accepted = verifyPassword(String(body?.exitPin ?? ""), childMode.exitPinHash);
    const learner = state.privateTutorLearners.find((row) => row.id === childMode.learnerId) ?? {
      id: childMode.learnerId,
      ownerTeamId: actor?.teamId ?? LOCAL_TEAM_ID,
    };
    if (!accepted) {
      childMode.failedExitAttempts = Number(childMode.failedExitAttempts ?? 0) + 1;
      if (childMode.failedExitAttempts >= EXIT_FAILURE_LIMIT) {
        childMode.failedExitAttempts = 0;
        childMode.lockedUntil = new Date(nowMs + EXIT_LOCK_MS).toISOString();
      }
      recordAudit(state, {
        learner,
        actor,
        action: "parent_reverification_failed",
        details: { lockedUntil: childMode.lockedUntil },
        now,
        nextId,
      });
      persistStateSoon();
      sendJson(res, 401, { error: "private_tutor_parent_reverification_failed" });
      return true;
    }
    delete session.privateTutorChildMode;
    recordAudit(state, {
      learner,
      actor,
      action: "child_mode_exited",
      details: { sessionId: session.id },
      now,
      nextId,
    });
    persistStateSoon();
    sendJson(res, 200, { active: false });
    return true;
  }

  if (url.pathname === "/api/private-tutor/learners") {
    if (req.method === "GET") {
      sendJson(res, 200, { learners: listAuthorizedLearners(state, actor) });
      return true;
    }
    if (req.method === "POST") {
      if (actor.privateTutorLearnerId) {
        sendJson(res, 403, { error: "private_tutor_child_mode_restricted" });
        return true;
      }
      const body = await readJson(req).catch(() => ({}));
      const validation = validateLearnerInput(body);
      if (!validation.ok) {
        sendJson(res, 400, validation.body);
        return true;
      }
      const createdAt = now();
      const ownerTeamId = actor?.teamId ?? LOCAL_TEAM_ID;
      const guardianUserId = actor?.userId ?? LOCAL_USER_ID;
      const learner = {
        id: nextId("lrn"),
        ownerTeamId,
        displayName: validation.displayName,
        grade: validation.grade,
        curriculumEditionId: validation.curriculumEditionId,
        status: "active",
        createdAt,
        createdBy: guardianUserId,
        updatedAt: createdAt,
      };
      const guardianLink = {
        id: nextId("grd"),
        ownerTeamId,
        learnerId: learner.id,
        guardianUserId,
        relationship: "guardian",
        permissions: ["read", "write", "manage"],
        verifiedAt: createdAt,
        createdAt,
      };
      const snapshot = createInitialSnapshot(learner, { now, nextId });
      state.privateTutorLearners.unshift(learner);
      state.privateTutorGuardianLinks.unshift(guardianLink);
      state.privateTutorSnapshots.unshift(snapshot);
      const audit = recordAudit(state, {
        learner,
        actor,
        action: "learner_created",
        details: { guardianLinkId: guardianLink.id },
        now,
        nextId,
      });
      persistStateSoon();
      sendJson(res, 201, { learner: learnerView(learner), snapshot: snapshotView(snapshot), audit });
      return true;
    }
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  const match = url.pathname.match(/^\/api\/private-tutor\/learners\/([^/]+)(?:\/(snapshot|attempts|audit))?$/);
  if (!match) return false;
  const learnerId = decodeURIComponent(match[1]);
  const resource = match[2] ?? null;
  const learner = findAuthorizedLearner(state, actor, learnerId);
  if (!learner) {
    recordDeniedAccess(state, { learnerId, actor, method: req.method, resource, now, nextId });
    persistStateSoon();
    sendJson(res, 404, learnerNotFound());
    return true;
  }

  if (actor.privateTutorLearnerId && (
    (!resource && req.method !== "GET")
    || resource === "audit"
    || (resource === "snapshot" && req.method !== "GET")
  )) {
    sendJson(res, 403, { error: "private_tutor_child_mode_restricted" });
    return true;
  }

  if (!resource && req.method === "GET") {
    sendJson(res, 200, { learner: learnerView(learner) });
    return true;
  }

  if (!resource && req.method === "DELETE") {
    const body = await readJson(req).catch(() => ({}));
    if (String(body?.confirmDisplayName ?? "") !== learner.displayName) {
      sendJson(res, 409, { error: "private_tutor_delete_confirmation_required" });
      return true;
    }
    const deletedAt = now();
    removeLearnerData(state, learner.id);
    const audit = recordAudit(state, {
      learner,
      actor,
      action: "learner_deleted",
      details: { deletedAt },
      now,
      nextId,
    });
    persistStateSoon();
    sendJson(res, 200, { deletedId: learner.id, audit });
    return true;
  }

  if (resource === "snapshot" && req.method === "GET") {
    const snapshot = state.privateTutorSnapshots.find((row) => row.learnerId === learner.id);
    if (!snapshot) {
      sendJson(res, 404, { error: "private_tutor_snapshot_not_found" });
      return true;
    }
    sendJson(res, 200, { learner: learnerView(learner), snapshot: snapshotView(snapshot) });
    return true;
  }

  if (resource === "attempts" && req.method === "POST") {
    const body = await readJson(req).catch(() => ({}));
    const validation = validateAttemptInput(body);
    if (!validation.ok) {
      sendJson(res, validation.status, validation.body);
      return true;
    }
    const requestHash = stableHash(validation.value);
    const existing = state.privateTutorIdempotencyRecords.find((row) =>
      row.learnerId === learner.id
      && row.actorId === (actor?.userId ?? LOCAL_USER_ID)
      && row.key === validation.value.idempotencyKey);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        sendJson(res, 409, { error: "private_tutor_idempotency_conflict" });
        return true;
      }
      const attempt = state.privateTutorAttempts.find((row) => row.id === existing.attemptId);
      const snapshot = state.privateTutorSnapshots.find((row) => row.learnerId === learner.id);
      sendJson(res, 200, { attempt, snapshot: snapshotView(snapshot), replayed: true });
      return true;
    }

    const createdAt = now();
    const attempt = {
      id: nextId("pta"),
      ownerTeamId: learner.ownerTeamId,
      learnerId: learner.id,
      actorId: actor?.userId ?? LOCAL_USER_ID,
      knowledgeId: validation.value.knowledgeId,
      questionRevisionId: validation.value.questionRevisionId,
      correct: validation.value.correct,
      independent: validation.value.independent,
      usedHint: validation.value.usedHint,
      source: validation.value.source,
      recognitionConfidence: validation.value.recognitionConfidence,
      durationSeconds: validation.value.durationSeconds,
      createdAt,
    };
    state.privateTutorAttempts.unshift(attempt);
    const snapshot = applyAttemptToSnapshot(state, learner, attempt, { now, nextId });
    state.privateTutorIdempotencyRecords.unshift({
      id: nextId("pti"),
      ownerTeamId: learner.ownerTeamId,
      learnerId: learner.id,
      actorId: actor?.userId ?? LOCAL_USER_ID,
      key: validation.value.idempotencyKey,
      requestHash,
      attemptId: attempt.id,
      createdAt,
    });
    recordAudit(state, {
      learner,
      actor,
      action: "attempt_recorded",
      details: { attemptId: attempt.id, knowledgeId: attempt.knowledgeId, source: attempt.source },
      now,
      nextId,
    });
    persistStateSoon();
    sendJson(res, 201, { attempt, snapshot: snapshotView(snapshot), replayed: false });
    return true;
  }

  if (resource === "audit" && req.method === "GET") {
    const audit = state.privateTutorAuditEvents
      .filter((row) => row.learnerId === learner.id && row.action !== "access_denied")
      .slice(0, 100);
    sendJson(res, 200, { audit });
    return true;
  }

  sendJson(res, 405, { error: "method_not_allowed" });
  return true;
}

function ensureCollections(state) {
  for (const key of [
    "privateTutorLearners",
    "privateTutorGuardianLinks",
    "privateTutorSnapshots",
    "privateTutorAttempts",
    "privateTutorIdempotencyRecords",
    "privateTutorAuditEvents",
  ]) {
    if (!Array.isArray(state[key])) state[key] = [];
  }
}

function validateLearnerInput(body) {
  const displayName = String(body?.displayName ?? "").trim();
  const grade = String(body?.grade ?? "").trim();
  const curriculumEditionId = body?.curriculumEditionId == null
    ? null
    : String(body.curriculumEditionId).trim().slice(0, 120) || null;
  if (!displayName || displayName.length > MAX_NAME_LENGTH) {
    return { ok: false, body: { error: "invalid_private_tutor_display_name" } };
  }
  if (!grade || grade.length > MAX_GRADE_LENGTH) {
    return { ok: false, body: { error: "invalid_private_tutor_grade" } };
  }
  return { ok: true, displayName, grade, curriculumEditionId };
}

function validateAttemptInput(body) {
  const idempotencyKey = String(body?.idempotencyKey ?? "").trim();
  const knowledgeId = String(body?.knowledgeId ?? "").trim();
  const questionRevisionId = String(body?.questionRevisionId ?? "").trim();
  const source = String(body?.source ?? "").trim();
  const recognitionConfidence = body?.recognitionConfidence == null ? null : Number(body.recognitionConfidence);
  const durationSeconds = Math.max(0, Math.min(1_800, Number(body?.durationSeconds ?? 0) || 0));
  if (!idempotencyKey || idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    return { ok: false, status: 400, body: { error: "invalid_private_tutor_idempotency_key" } };
  }
  if (!KNOWLEDGE_IDS.has(knowledgeId) || !questionRevisionId || questionRevisionId.length > 120) {
    return { ok: false, status: 400, body: { error: "invalid_private_tutor_attempt_reference" } };
  }
  if (!ATTEMPT_SOURCES.has(source)) {
    return { ok: false, status: 400, body: { error: "invalid_private_tutor_attempt_source" } };
  }
  if (source === "voice_confirmed" && (!Number.isFinite(recognitionConfidence) || recognitionConfidence < 0.75)) {
    return {
      ok: false,
      status: 409,
      body: { error: "private_tutor_voice_confirmation_required", minimumConfidence: 0.75 },
    };
  }
  return {
    ok: true,
    value: {
      idempotencyKey,
      knowledgeId,
      questionRevisionId,
      correct: body?.correct === true,
      independent: body?.independent === true,
      usedHint: body?.usedHint === true,
      source,
      recognitionConfidence: Number.isFinite(recognitionConfidence) ? recognitionConfidence : null,
      durationSeconds,
    },
  };
}

function listAuthorizedLearners(state, actor) {
  return state.privateTutorLearners
    .filter((learner) => findAuthorizedLearner(state, actor, learner.id))
    .map(learnerView);
}

function findAuthorizedLearner(state, actor, learnerId) {
  const teamId = actor?.teamId ?? LOCAL_TEAM_ID;
  const userId = actor?.userId ?? LOCAL_USER_ID;
  if (actor?.privateTutorLearnerId && actor.privateTutorLearnerId !== learnerId) return null;
  const learner = state.privateTutorLearners.find((row) =>
    row.id === learnerId && row.status === "active" && row.ownerTeamId === teamId);
  if (!learner) return null;
  const link = state.privateTutorGuardianLinks.find((row) =>
    row.learnerId === learnerId
    && row.ownerTeamId === teamId
    && row.guardianUserId === userId
    && row.verifiedAt);
  return link ? learner : null;
}

function createInitialSnapshot(learner, { now, nextId }) {
  const createdAt = now();
  return {
    id: nextId("pts"),
    ownerTeamId: learner.ownerTeamId,
    learnerId: learner.id,
    revision: 1,
    dailyMinutes: 0,
    completedSessions: 0,
    independentAnswers: 0,
    knowledge: [
      { id: "integer", mastery: null, level: "unknown", evidenceCount: 0 },
      { id: "equation-meaning", mastery: null, level: "unknown", evidenceCount: 0 },
      { id: "balance", mastery: null, level: "unknown", evidenceCount: 0 },
      { id: "word-problem", mastery: null, level: "unknown", evidenceCount: 0 },
    ],
    updatedAt: createdAt,
  };
}

function applyAttemptToSnapshot(state, learner, attempt, { now, nextId }) {
  let snapshot = state.privateTutorSnapshots.find((row) => row.learnerId === learner.id);
  if (!snapshot) {
    snapshot = createInitialSnapshot(learner, { now, nextId });
    state.privateTutorSnapshots.unshift(snapshot);
  }
  const knowledge = snapshot.knowledge.find((row) => row.id === attempt.knowledgeId);
  const startingMastery = knowledge.mastery ?? 0.5;
  const delta = attempt.correct
    ? attempt.independent && !attempt.usedHint ? 0.12 : 0.04
    : -0.05;
  knowledge.mastery = Math.max(0, Math.min(1, Number((startingMastery + delta).toFixed(2))));
  knowledge.evidenceCount += 1;
  knowledge.level = knowledge.mastery >= 0.8
    ? "mastered"
    : knowledge.mastery >= 0.55
      ? "learning"
      : "needs_support";
  snapshot.revision += 1;
  snapshot.dailyMinutes = Math.min(20, snapshot.dailyMinutes + Math.max(1, Math.ceil(attempt.durationSeconds / 60)));
  if (attempt.correct && attempt.independent && !attempt.usedHint) snapshot.independentAnswers += 1;
  snapshot.updatedAt = now();
  return snapshot;
}

function removeLearnerData(state, learnerId) {
  for (const key of [
    "privateTutorLearners",
    "privateTutorGuardianLinks",
    "privateTutorSnapshots",
    "privateTutorAttempts",
    "privateTutorIdempotencyRecords",
  ]) {
    state[key] = state[key].filter((row) => row.learnerId !== learnerId && row.id !== learnerId);
  }
}

function learnerView(learner) {
  return {
    id: learner.id,
    displayName: learner.displayName,
    grade: learner.grade,
    curriculumEditionId: learner.curriculumEditionId,
    status: learner.status,
    createdAt: learner.createdAt,
    updatedAt: learner.updatedAt,
  };
}

function snapshotView(snapshot) {
  if (!snapshot) return null;
  return {
    id: snapshot.id,
    learnerId: snapshot.learnerId,
    revision: snapshot.revision,
    dailyMinutes: snapshot.dailyMinutes,
    completedSessions: snapshot.completedSessions,
    independentAnswers: snapshot.independentAnswers,
    knowledge: snapshot.knowledge.map((row) => ({ ...row })),
    updatedAt: snapshot.updatedAt,
  };
}

function recordAudit(state, { learner, actor, action, details, now, nextId }) {
  const audit = {
    id: nextId("ptu"),
    ownerTeamId: learner.ownerTeamId,
    learnerId: learner.id,
    actorId: actor?.userId ?? LOCAL_USER_ID,
    action,
    details,
    at: now(),
  };
  state.privateTutorAuditEvents.unshift(audit);
  return audit;
}

function recordDeniedAccess(state, { learnerId, actor, method, resource, now, nextId }) {
  state.privateTutorAuditEvents.unshift({
    id: nextId("ptu"),
    ownerTeamId: actor?.teamId ?? LOCAL_TEAM_ID,
    learnerId,
    actorId: actor?.userId ?? LOCAL_USER_ID,
    action: "access_denied",
    details: { method, resource: resource ?? "learner" },
    at: now(),
  });
}

function stableHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function childModeView(actor) {
  return actor?.privateTutorLearnerId ? {
    active: true,
    learnerId: actor.privateTutorLearnerId,
    enteredAt: actor.privateTutorChildModeEnteredAt,
  } : { active: false, learnerId: null, enteredAt: null };
}

function learnerNotFound() {
  return { error: "private_tutor_learner_not_found" };
}
