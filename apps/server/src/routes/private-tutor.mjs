import { createHash } from "node:crypto";
import { hashPassword, verifyPassword } from "../runtime/auth.mjs";
import {
  buildDiagnosticResult,
  DIAGNOSTIC_MAX_QUESTIONS,
  DIAGNOSTIC_MIN_QUESTIONS,
  DIAGNOSTIC_TARGET_SECONDS,
  initialDiagnosticQuestion,
  judgePrivateTutorAnswer,
  privateTutorQuestion,
  publicQuestion,
  selectNextDiagnosticQuestion,
} from "../services/private-tutor-assessment.mjs";
import {
  buildPrivateTutorSevenDayPlan,
  decidePrivateTutorStrategy,
  derivePrivateTutorLearnerModel,
} from "../services/private-tutor-learning-model.mjs";
import {
  completePrivateTutorActivity,
  createPrivateTutorSession,
  currentPrivateTutorActivity,
  pausePrivateTutorSession,
  PRIVATE_TUTOR_SESSION_PACES,
  privateTutorSessionView,
  recordPrivateTutorSessionAnswer,
  resumePrivateTutorSession,
  revealPrivateTutorHint,
} from "../services/private-tutor-session.mjs";
import {
  normalizePrivateTutorSpeech,
  privateTutorVoiceTurnView,
} from "../services/private-tutor-voice.mjs";

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
const VOICE_MODES = new Set(["push_to_talk", "hands_free"]);
const VOICE_EVENT_TYPES = new Set([
  "recognition_started",
  "recognition_stopped",
  "recognition_error",
  "playback_started",
  "playback_completed",
  "playback_interrupted",
  "mode_changed",
]);

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

  const assessmentMatch = url.pathname.match(/^\/api\/private-tutor\/learners\/([^/]+)\/assessments\/(current|start|([^/]+)\/(answers|pause|resume))$/);
  if (assessmentMatch) {
    const learnerId = decodeURIComponent(assessmentMatch[1]);
    const learner = findAuthorizedLearner(state, actor, learnerId);
    if (!learner) {
      recordDeniedAccess(state, { learnerId, actor, method: req.method, resource: "assessment", now, nextId });
      persistStateSoon();
      sendJson(res, 404, learnerNotFound());
      return true;
    }
    return handleAssessmentRoute({
      req,
      res,
      sendJson,
      readJson,
      state,
      actor,
      learner,
      action: assessmentMatch[2],
      assessmentId: assessmentMatch[3] ? decodeURIComponent(assessmentMatch[3]) : null,
      now,
      nextId,
      persistStateSoon,
    });
  }

  const voiceMatch = url.pathname.match(/^\/api\/private-tutor\/learners\/([^/]+)\/tutoring-sessions\/([^/]+)\/(voice-turns|voice-events)$/);
  if (voiceMatch) {
    const learnerId = decodeURIComponent(voiceMatch[1]);
    const learner = findAuthorizedLearner(state, actor, learnerId);
    if (!learner) {
      recordDeniedAccess(state, { learnerId, actor, method: req.method, resource: "tutoring-voice", now, nextId });
      persistStateSoon();
      sendJson(res, 404, learnerNotFound());
      return true;
    }
    return handleTutoringVoiceRoute({
      req,
      res,
      sendJson,
      readJson,
      state,
      actor,
      learner,
      sessionId: decodeURIComponent(voiceMatch[2]),
      resource: voiceMatch[3],
      now,
      nextId,
      persistStateSoon,
    });
  }

  const tutoringSessionMatch = url.pathname.match(/^\/api\/private-tutor\/learners\/([^/]+)\/tutoring-sessions\/(current|start|([^/]+)\/(actions|pause|resume))$/);
  if (tutoringSessionMatch) {
    const learnerId = decodeURIComponent(tutoringSessionMatch[1]);
    const learner = findAuthorizedLearner(state, actor, learnerId);
    if (!learner) {
      recordDeniedAccess(state, { learnerId, actor, method: req.method, resource: "tutoring-session", now, nextId });
      persistStateSoon();
      sendJson(res, 404, learnerNotFound());
      return true;
    }
    return handleTutoringSessionRoute({
      req,
      res,
      sendJson,
      readJson,
      state,
      actor,
      learner,
      action: tutoringSessionMatch[2],
      sessionId: tutoringSessionMatch[3] ? decodeURIComponent(tutoringSessionMatch[3]) : null,
      now,
      nextId,
      persistStateSoon,
    });
  }

  const learningPlanMatch = url.pathname.match(/^\/api\/private-tutor\/learners\/([^/]+)\/learning-plan(?:\/(rebalance))?$/);
  if (learningPlanMatch) {
    const learnerId = decodeURIComponent(learningPlanMatch[1]);
    const learner = findAuthorizedLearner(state, actor, learnerId);
    if (!learner) {
      recordDeniedAccess(state, { learnerId, actor, method: req.method, resource: "learning-plan", now, nextId });
      persistStateSoon();
      sendJson(res, 404, learnerNotFound());
      return true;
    }
    if (!learningPlanMatch[2] && req.method === "GET") {
      sendJson(res, 200, currentPrivateTutorIntelligence(state, learner.id));
      return true;
    }
    if (learningPlanMatch[2] === "rebalance" && req.method === "POST") {
      const body = await readJson(req).catch(() => ({}));
      const missedDayIndex = Number(body?.missedDayIndex);
      const currentPlan = state.privateTutorLearningPlans.find((row) => row.learnerId === learner.id);
      if (!currentPlan || !Number.isInteger(missedDayIndex) || missedDayIndex < 1 || missedDayIndex > 7) {
        sendJson(res, 400, { error: "invalid_private_tutor_plan_rebalance" });
        return true;
      }
      const carryForwardKnowledgeId = currentPlan.days.find((day) => day.dayIndex === missedDayIndex)?.knowledgeId ?? null;
      const intelligence = refreshPrivateTutorIntelligence(state, learner, {
        now,
        nextId,
        reason: "missed_day_rescheduled",
        carryForwardKnowledgeId,
      });
      recordAudit(state, {
        learner,
        actor,
        action: "learning_plan_rebalanced",
        details: { missedDayIndex, planId: intelligence.learningPlan?.id ?? null },
        now,
        nextId,
      });
      persistStateSoon();
      sendJson(res, 200, intelligence);
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
    sendJson(res, 200, {
      learner: learnerView(learner),
      snapshot: snapshotView(snapshot),
      ...currentPrivateTutorIntelligence(state, learner.id),
    });
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
      sendJson(res, 200, {
        attempt,
        snapshot: snapshotView(snapshot),
        ...currentPrivateTutorIntelligence(state, learner.id),
        replayed: true,
      });
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
      responseKind: validation.value.responseKind,
      normalizedAnswer: validation.value.normalizedAnswer,
      judgementReason: validation.value.judgementReason,
      durationSeconds: validation.value.durationSeconds,
      createdAt,
    };
    state.privateTutorAttempts.unshift(attempt);
    const snapshot = applyAttemptToSnapshot(state, learner, attempt, { now, nextId });
    const intelligence = refreshPrivateTutorIntelligence(state, learner, {
      now,
      nextId,
      reason: "new_learning_evidence",
    });
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
    sendJson(res, 201, { attempt, snapshot: snapshotView(snapshot), ...intelligence, replayed: false });
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

async function handleAssessmentRoute({
  req,
  res,
  sendJson,
  readJson,
  state,
  actor,
  learner,
  action,
  assessmentId,
  now,
  nextId,
  persistStateSoon,
}) {
  const latest = state.privateTutorAssessments.find((row) => row.learnerId === learner.id) ?? null;
  if (action === "current") {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    sendJson(res, 200, { assessment: assessmentView(latest) });
    return true;
  }

  if (action === "start") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const body = await readJson(req).catch(() => ({}));
    if (latest && ["active", "paused"].includes(latest.status)) {
      sendJson(res, 200, { assessment: assessmentView(latest), resumed: true });
      return true;
    }
    if (latest?.status === "completed" && body?.restart !== true) {
      sendJson(res, 200, { assessment: assessmentView(latest), resumed: true });
      return true;
    }
    if (latest?.status === "completed" && body?.restart === true && actor?.privateTutorLearnerId) {
      sendJson(res, 403, { error: "private_tutor_parent_reverification_required" });
      return true;
    }
    const startedAt = now();
    const firstQuestion = initialDiagnosticQuestion();
    const assessment = {
      id: nextId("pas"),
      ownerTeamId: learner.ownerTeamId,
      learnerId: learner.id,
      status: "active",
      revision: 1,
      startedAt,
      pausedAt: null,
      completedAt: null,
      activeSeconds: 0,
      targetSeconds: DIAGNOSTIC_TARGET_SECONDS,
      minQuestions: DIAGNOSTIC_MIN_QUESTIONS,
      maxQuestions: DIAGNOSTIC_MAX_QUESTIONS,
      currentQuestionRevisionId: firstQuestion.revisionId,
      questionPresentedAt: startedAt,
      currentQuestionActiveSeconds: 0,
      answerSummaries: [],
      result: null,
      updatedAt: startedAt,
    };
    state.privateTutorAssessments.unshift(assessment);
    recordAudit(state, { learner, actor, action: "diagnostic_started", details: { assessmentId: assessment.id }, now, nextId });
    persistStateSoon();
    sendJson(res, 201, { assessment: assessmentView(assessment), resumed: false });
    return true;
  }

  const assessment = state.privateTutorAssessments.find((row) => row.id === assessmentId && row.learnerId === learner.id);
  if (!assessment) {
    sendJson(res, 404, { error: "private_tutor_assessment_not_found" });
    return true;
  }

  if (action.endsWith("/pause") || action === `${assessmentId}/pause`) {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    if (assessment.status !== "active") {
      sendJson(res, 409, { error: "private_tutor_assessment_not_active" });
      return true;
    }
    assessment.status = "paused";
    assessment.pausedAt = now();
    assessment.currentQuestionActiveSeconds += elapsedSeconds(assessment.questionPresentedAt, assessment.pausedAt);
    assessment.questionPresentedAt = null;
    assessment.updatedAt = assessment.pausedAt;
    assessment.revision += 1;
    recordAudit(state, { learner, actor, action: "diagnostic_paused", details: { assessmentId }, now, nextId });
    persistStateSoon();
    sendJson(res, 200, { assessment: assessmentView(assessment) });
    return true;
  }

  if (action.endsWith("/resume") || action === `${assessmentId}/resume`) {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    if (assessment.status !== "paused") {
      sendJson(res, 409, { error: "private_tutor_assessment_not_paused" });
      return true;
    }
    assessment.status = "active";
    assessment.pausedAt = null;
    assessment.updatedAt = now();
    assessment.questionPresentedAt = assessment.updatedAt;
    assessment.revision += 1;
    recordAudit(state, { learner, actor, action: "diagnostic_resumed", details: { assessmentId }, now, nextId });
    persistStateSoon();
    sendJson(res, 200, { assessment: assessmentView(assessment) });
    return true;
  }

  if (!(action.endsWith("/answers") || action === `${assessmentId}/answers`) || req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }
  const body = await readJson(req).catch(() => ({}));
  const idempotencyKey = String(body?.idempotencyKey ?? "").trim();
  const questionRevisionId = String(body?.questionRevisionId ?? "").trim();
  const source = String(body?.source ?? "screen").trim();
  const recognitionConfidence = body?.recognitionConfidence == null ? null : Number(body.recognitionConfidence);
  const durationSeconds = Math.max(0, Math.min(180, Number(body?.durationSeconds ?? 0) || 0));
  if (!idempotencyKey || idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    sendJson(res, 400, { error: "invalid_private_tutor_idempotency_key" });
    return true;
  }
  if (!ATTEMPT_SOURCES.has(source)) {
    sendJson(res, 400, { error: "invalid_private_tutor_attempt_source" });
    return true;
  }
  if (source === "voice_confirmed" && (!Number.isFinite(recognitionConfidence) || recognitionConfidence < 0.75)) {
    sendJson(res, 409, { error: "private_tutor_voice_confirmation_required", minimumConfidence: 0.75 });
    return true;
  }
  const requestValue = {
    assessmentId,
    questionRevisionId,
    rawAnswer: String(body?.rawAnswer ?? ""),
    responseKind: String(body?.responseKind ?? "answer"),
    source,
    recognitionConfidence: Number.isFinite(recognitionConfidence) ? recognitionConfidence : null,
    durationSeconds,
  };
  const requestHash = stableHash(requestValue);
  const actorId = actor?.userId ?? LOCAL_USER_ID;
  const existing = state.privateTutorIdempotencyRecords.find((row) =>
    row.learnerId === learner.id && row.actorId === actorId && row.key === idempotencyKey);
  if (existing) {
    if (existing.requestHash !== requestHash || existing.operation !== "assessment_answer") {
      sendJson(res, 409, { error: "private_tutor_idempotency_conflict" });
      return true;
    }
    sendJson(res, 200, { ...existing.response, replayed: true });
    return true;
  }
  if (assessment.status !== "active") {
    sendJson(res, 409, { error: "private_tutor_assessment_not_active" });
    return true;
  }
  if (questionRevisionId !== assessment.currentQuestionRevisionId) {
    sendJson(res, 409, { error: "private_tutor_assessment_question_mismatch" });
    return true;
  }
  const question = privateTutorQuestion(questionRevisionId);
  if (!question || question.context !== "diagnostic") {
    sendJson(res, 400, { error: "private_tutor_question_revision_not_found" });
    return true;
  }
  const judgement = judgePrivateTutorAnswer(questionRevisionId, requestValue);
  if (!judgement.accepted) {
    sendJson(res, 422, { error: judgement.error });
    return true;
  }

  const createdAt = now();
  const serverDurationSeconds = Math.min(180,
    assessment.currentQuestionActiveSeconds + elapsedSeconds(assessment.questionPresentedAt, createdAt));
  const attempt = {
    id: nextId("pta"),
    ownerTeamId: learner.ownerTeamId,
    learnerId: learner.id,
    actorId,
    assessmentId,
    context: "diagnostic",
    knowledgeId: question.knowledgeId,
    questionRevisionId,
    correct: judgement.correct,
    independent: true,
    usedHint: false,
    source,
    recognitionConfidence: Number.isFinite(recognitionConfidence) ? recognitionConfidence : null,
    responseKind: judgement.responseKind,
    normalizedAnswer: judgement.normalizedAnswer,
    judgementReason: judgement.reason,
    durationSeconds: serverDurationSeconds,
    clientDurationSeconds: durationSeconds,
    createdAt,
  };
  state.privateTutorAttempts.unshift(attempt);
  assessment.answerSummaries.push({
    attemptId: attempt.id,
    questionRevisionId,
    knowledgeId: question.knowledgeId,
    difficulty: question.difficulty,
    correct: attempt.correct,
    responseKind: attempt.responseKind,
  });
  assessment.activeSeconds = Math.min(DIAGNOSTIC_TARGET_SECONDS, assessment.activeSeconds + serverDurationSeconds);
  assessment.currentQuestionActiveSeconds = 0;
  assessment.questionPresentedAt = createdAt;
  assessment.revision += 1;
  assessment.updatedAt = createdAt;
  const nextQuestion = selectNextDiagnosticQuestion(assessment.answerSummaries);
  assessment.currentQuestionRevisionId = nextQuestion?.revisionId ?? null;
  if (!nextQuestion) {
    assessment.status = "completed";
    assessment.completedAt = createdAt;
    assessment.questionPresentedAt = null;
    assessment.result = buildDiagnosticResult(assessment.answerSummaries);
    applyDiagnosticResultToSnapshot(state, learner, assessment, { now, nextId });
    refreshPrivateTutorIntelligence(state, learner, {
      now,
      nextId,
      reason: "diagnostic_completed",
    });
    recordAudit(state, {
      learner,
      actor,
      action: "diagnostic_completed",
      details: { assessmentId, answeredCount: assessment.answerSummaries.length },
      now,
      nextId,
    });
  }
  const response = { assessment: assessmentView(assessment) };
  state.privateTutorIdempotencyRecords.unshift({
    id: nextId("pti"),
    ownerTeamId: learner.ownerTeamId,
    learnerId: learner.id,
    actorId,
    key: idempotencyKey,
    operation: "assessment_answer",
    requestHash,
    attemptId: attempt.id,
    response,
    createdAt,
  });
  persistStateSoon();
  sendJson(res, 201, { ...response, replayed: false });
  return true;
}

async function handleTutoringVoiceRoute({
  req,
  res,
  sendJson,
  readJson,
  state,
  actor,
  learner,
  sessionId,
  resource,
  now,
  nextId,
  persistStateSoon,
}) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }
  const session = state.privateTutorSessions.find((row) => row.id === sessionId && row.learnerId === learner.id);
  if (!session) {
    sendJson(res, 404, { error: "private_tutor_session_not_found" });
    return true;
  }
  if (session.status !== "active") {
    sendJson(res, 409, { error: "private_tutor_session_not_active" });
    return true;
  }
  const body = await readJson(req).catch(() => ({}));
  if (Object.keys(body ?? {}).some((key) => /^audio/i.test(key))) {
    sendJson(res, 400, { error: "private_tutor_raw_audio_not_accepted" });
    return true;
  }

  if (resource === "voice-events") {
    const type = String(body?.type ?? "");
    if (!VOICE_EVENT_TYPES.has(type)) {
      sendJson(res, 400, { error: "invalid_private_tutor_voice_event" });
      return true;
    }
    const createdAt = now();
    const event = {
      id: nextId("ptve"),
      ownerTeamId: learner.ownerTeamId,
      learnerId: learner.id,
      sessionId: session.id,
      actorId: actor?.userId ?? LOCAL_USER_ID,
      type,
      reason: String(body?.reason ?? "").slice(0, 80) || null,
      createdAt,
    };
    state.privateTutorVoiceEvents.unshift(event);
    persistStateSoon();
    sendJson(res, 201, { event: { id: event.id, type: event.type, createdAt } });
    return true;
  }

  const clientTurnId = String(body?.clientTurnId ?? "").trim();
  const transcript = String(body?.transcript ?? "").trim();
  const mode = String(body?.mode ?? "push_to_talk");
  const provider = String(body?.provider ?? "browser_web_speech").slice(0, 60);
  const alternatives = Array.isArray(body?.alternatives)
    ? body.alternatives.map((value) => String(value ?? "").slice(0, 300)).slice(0, 3)
    : [];
  if (!clientTurnId || clientTurnId.length > MAX_IDEMPOTENCY_KEY_LENGTH || !transcript || transcript.length > 300 || !VOICE_MODES.has(mode)) {
    sendJson(res, 400, { error: "invalid_private_tutor_voice_turn" });
    return true;
  }
  const activity = currentPrivateTutorActivity(session);
  const question = activity?.questionRevisionId ? privateTutorQuestion(activity.questionRevisionId) : null;
  if (!question) {
    sendJson(res, 409, { error: "private_tutor_voice_question_required" });
    return true;
  }
  const requestValue = {
    transcript,
    confidence: body?.confidence,
    alternatives,
    mode,
    provider,
    questionRevisionId: question.id,
  };
  const requestHash = stableHash(requestValue);
  const existing = state.privateTutorVoiceTurns.find((row) =>
    row.learnerId === learner.id
    && row.sessionId === session.id
    && row.actorId === (actor?.userId ?? LOCAL_USER_ID)
    && row.clientTurnId === clientTurnId);
  if (existing) {
    if (existing.requestHash !== requestHash) {
      sendJson(res, 409, { error: "private_tutor_voice_turn_conflict" });
      return true;
    }
    sendJson(res, 200, { voiceTurn: privateTutorVoiceTurnView(existing), replayed: true });
    return true;
  }
  const normalization = normalizePrivateTutorSpeech({ ...requestValue, question });
  if (!normalization.accepted) {
    sendJson(res, 400, { error: normalization.error });
    return true;
  }
  const createdAt = now();
  const voiceTurn = {
    id: nextId("ptvt"),
    ownerTeamId: learner.ownerTeamId,
    learnerId: learner.id,
    sessionId: session.id,
    actorId: actor?.userId ?? LOCAL_USER_ID,
    clientTurnId,
    requestHash,
    questionRevisionId: question.id,
    mode,
    provider,
    transcript: normalization.transcript,
    normalizedExpression: normalization.normalizedExpression,
    confidence: normalization.confidence,
    status: normalization.status,
    reasonCodes: normalization.reasonCodes,
    attemptId: null,
    createdAt,
    confirmedAt: null,
  };
  state.privateTutorVoiceTurns.unshift(voiceTurn);
  recordTutoringSessionEvent(state, {
    learner,
    actor,
    session,
    type: "voice_turn_normalized",
    details: { voiceTurnId: voiceTurn.id, status: voiceTurn.status, reasonCodes: voiceTurn.reasonCodes },
    now,
    nextId,
  });
  persistStateSoon();
  sendJson(res, 201, { voiceTurn: privateTutorVoiceTurnView(voiceTurn), replayed: false });
  return true;
}

async function handleTutoringSessionRoute({
  req,
  res,
  sendJson,
  readJson,
  state,
  actor,
  learner,
  action,
  sessionId,
  now,
  nextId,
  persistStateSoon,
}) {
  const actorId = actor?.userId ?? LOCAL_USER_ID;
  const sessions = state.privateTutorSessions.filter((row) => row.learnerId === learner.id);
  const current = sessions.find((row) => row.status === "active" || row.status === "paused") ?? sessions[0] ?? null;

  if (action === "current") {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    sendJson(res, 200, { session: privateTutorSessionView(current) });
    return true;
  }

  if (action === "start") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const resumable = sessions.find((row) => row.status === "active" || row.status === "paused");
    if (resumable) {
      sendJson(res, 200, { session: privateTutorSessionView(resumable), resumedExisting: true });
      return true;
    }
    const snapshot = state.privateTutorSnapshots.find((row) => row.learnerId === learner.id);
    const plan = state.privateTutorLearningPlans.find((row) => row.learnerId === learner.id);
    const decision = state.privateTutorStrategyDecisions.find((row) => row.learnerId === learner.id);
    if (!snapshot?.diagnosticCompletedAt || !plan || !decision) {
      sendJson(res, 409, { error: "private_tutor_learning_plan_required" });
      return true;
    }
    const body = await readJson(req).catch(() => ({}));
    const pace = String(body?.pace ?? "standard");
    if (!PRIVATE_TUTOR_SESSION_PACES[pace]) {
      sendJson(res, 400, { error: "invalid_private_tutor_session_pace" });
      return true;
    }
    const session = createPrivateTutorSession({
      id: nextId("ptsess"),
      ownerTeamId: learner.ownerTeamId,
      learnerId: learner.id,
      plan,
      decision,
      pace,
      now,
    });
    if (!session) {
      sendJson(res, 409, { error: "private_tutor_session_content_unavailable" });
      return true;
    }
    state.privateTutorSessions.unshift(session);
    recordTutoringSessionEvent(state, { learner, actor, session, type: "session_started", details: { pace }, now, nextId });
    recordAudit(state, { learner, actor, action: "tutoring_session_started", details: { sessionId: session.id, pace }, now, nextId });
    persistStateSoon();
    sendJson(res, 201, { session: privateTutorSessionView(session), resumedExisting: false });
    return true;
  }

  const session = state.privateTutorSessions.find((row) => row.id === sessionId && row.learnerId === learner.id);
  if (!session) {
    sendJson(res, 404, { error: "private_tutor_session_not_found" });
    return true;
  }

  if (action.endsWith("/pause") || action === `${sessionId}/pause`) {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    if (!pausePrivateTutorSession(session, now)) {
      sendJson(res, 409, { error: "private_tutor_session_not_active" });
      return true;
    }
    recordTutoringSessionEvent(state, { learner, actor, session, type: "session_paused", details: { activity: currentPrivateTutorActivity(session)?.kind ?? null }, now, nextId });
    persistStateSoon();
    sendJson(res, 200, { session: privateTutorSessionView(session) });
    return true;
  }

  if (action.endsWith("/resume") || action === `${sessionId}/resume`) {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    if (!resumePrivateTutorSession(session, now)) {
      sendJson(res, 409, { error: "private_tutor_session_not_paused" });
      return true;
    }
    recordTutoringSessionEvent(state, { learner, actor, session, type: "session_resumed", details: { activity: currentPrivateTutorActivity(session)?.kind ?? null }, now, nextId });
    persistStateSoon();
    sendJson(res, 200, { session: privateTutorSessionView(session) });
    return true;
  }

  if (!(action.endsWith("/actions") || action === `${sessionId}/actions`) || req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }
  if (session.status !== "active") {
    sendJson(res, 409, { error: "private_tutor_session_not_active" });
    return true;
  }
  const body = await readJson(req).catch(() => ({}));
  const actionType = String(body?.action ?? "");
  const activity = currentPrivateTutorActivity(session);

  if (actionType === "continue") {
    if (!activity || !["explain", "summary"].includes(activity.kind)) {
      sendJson(res, 409, { error: "private_tutor_session_answer_required" });
      return true;
    }
    const completedKind = activity.kind;
    const result = completePrivateTutorActivity(session, now);
    if (result.completed) {
      const snapshot = state.privateTutorSnapshots.find((row) => row.learnerId === learner.id);
      if (snapshot) {
        snapshot.completedSessions += 1;
        snapshot.dailyMinutes = Math.min(20, Math.max(snapshot.dailyMinutes, session.plannedMinutes));
        snapshot.revision += 1;
        snapshot.updatedAt = session.completedAt;
      }
      recordAudit(state, {
        learner,
        actor,
        action: "tutoring_session_completed",
        details: { sessionId: session.id, independentCompleted: session.summary.independentCompleted },
        now,
        nextId,
      });
    }
    recordTutoringSessionEvent(state, { learner, actor, session, type: result.completed ? "session_completed" : "activity_completed", details: { activity: completedKind }, now, nextId });
    persistStateSoon();
    sendJson(res, 200, { session: privateTutorSessionView(session), snapshot: snapshotView(state.privateTutorSnapshots.find((row) => row.learnerId === learner.id)) });
    return true;
  }

  if (actionType === "hint") {
    const result = revealPrivateTutorHint(session, now);
    if (!result.ok) {
      sendJson(res, 409, { error: result.error });
      return true;
    }
    recordTutoringSessionEvent(state, { learner, actor, session, type: "hint_revealed", details: { activity: activity.kind, level: activity.hintLevel }, now, nextId });
    persistStateSoon();
    sendJson(res, 200, { session: privateTutorSessionView(session) });
    return true;
  }

  if (actionType !== "answer") {
    sendJson(res, 400, { error: "invalid_private_tutor_session_action" });
    return true;
  }
  const idempotencyKey = String(body?.idempotencyKey ?? "").trim();
  const voiceTurnId = String(body?.voiceTurnId ?? "").trim() || null;
  const voiceTurn = voiceTurnId
    ? state.privateTutorVoiceTurns.find((row) => row.id === voiceTurnId && row.learnerId === learner.id && row.sessionId === session.id)
    : null;
  const questionRevisionId = voiceTurn?.questionRevisionId ?? String(body?.questionRevisionId ?? "").trim();
  const source = voiceTurn ? "voice_confirmed" : String(body?.source ?? "screen").trim();
  const recognitionConfidence = voiceTurn?.confidence
    ?? (body?.recognitionConfidence == null ? null : Number(body.recognitionConfidence));
  if (!idempotencyKey || idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    sendJson(res, 400, { error: "invalid_private_tutor_idempotency_key" });
    return true;
  }
  if (voiceTurnId && !voiceTurn) {
    sendJson(res, 404, { error: "private_tutor_voice_turn_not_found" });
    return true;
  }
  if (!ATTEMPT_SOURCES.has(source)) {
    sendJson(res, 400, { error: "invalid_private_tutor_attempt_source" });
    return true;
  }
  if (!voiceTurn && source === "voice_confirmed" && (!Number.isFinite(recognitionConfidence) || recognitionConfidence < 0.75)) {
    sendJson(res, 409, { error: "private_tutor_voice_confirmation_required", minimumConfidence: 0.75 });
    return true;
  }
  const requestValue = {
    sessionId: session.id,
    questionRevisionId,
    rawAnswer: voiceTurn?.normalizedExpression ?? String(body?.rawAnswer ?? ""),
    responseKind: String(body?.responseKind ?? "answer"),
    source,
    recognitionConfidence: Number.isFinite(recognitionConfidence) ? recognitionConfidence : null,
    voiceTurnId,
  };
  const requestHash = stableHash(requestValue);
  const existing = state.privateTutorIdempotencyRecords.find((row) =>
    row.learnerId === learner.id && row.actorId === actorId && row.key === idempotencyKey);
  if (existing) {
    if (existing.requestHash !== requestHash || existing.operation !== "tutoring_session_answer") {
      sendJson(res, 409, { error: "private_tutor_idempotency_conflict" });
      return true;
    }
    sendJson(res, 200, { ...existing.response, replayed: true });
    return true;
  }
  if (voiceTurn && voiceTurn.status === "unsupported") {
    sendJson(res, 422, { error: "private_tutor_voice_expression_unsupported" });
    return true;
  }
  if (voiceTurn?.attemptId || voiceTurn?.status === "confirmed") {
    sendJson(res, 409, { error: "private_tutor_voice_turn_already_confirmed" });
    return true;
  }
  if (!activity?.questionRevisionId) {
    sendJson(res, 400, { error: "invalid_private_tutor_session_action" });
    return true;
  }
  if (questionRevisionId !== activity.questionRevisionId) {
    sendJson(res, 409, { error: "private_tutor_session_question_mismatch" });
    return true;
  }
  const question = privateTutorQuestion(questionRevisionId);
  if (!question || question.context !== "tutoring" || question.knowledgeId !== session.targetKnowledgeId) {
    sendJson(res, 400, { error: "private_tutor_question_revision_not_found" });
    return true;
  }
  const judgement = judgePrivateTutorAnswer(questionRevisionId, requestValue);
  if (!judgement.accepted) {
    sendJson(res, 422, { error: judgement.error });
    return true;
  }
  const createdAt = now();
  const attempt = {
    id: nextId("pta"),
    ownerTeamId: learner.ownerTeamId,
    learnerId: learner.id,
    actorId,
    sessionId: session.id,
    context: "tutoring",
    activityKind: activity.kind,
    knowledgeId: session.targetKnowledgeId,
    questionRevisionId,
    correct: judgement.correct,
    independent: activity.kind === "independent_check" && activity.hintLevel === 0,
    usedHint: activity.hintLevel > 0,
    source,
    recognitionConfidence: Number.isFinite(recognitionConfidence) ? recognitionConfidence : null,
    responseKind: judgement.responseKind,
    normalizedAnswer: judgement.normalizedAnswer,
    judgementReason: judgement.reason,
    durationSeconds: Math.min(activity.budgetMinutes * 60, elapsedSeconds(activity.startedAt, createdAt)),
    createdAt,
  };
  state.privateTutorAttempts.unshift(attempt);
  const snapshot = applyAttemptToSnapshot(state, learner, attempt, { now, nextId });
  const answerResult = recordPrivateTutorSessionAnswer(session, { correct: attempt.correct, attemptId: attempt.id, now });
  const intelligence = refreshPrivateTutorIntelligence(state, learner, { now, nextId, reason: "tutoring_session_evidence" });
  if (voiceTurn) {
    voiceTurn.status = "confirmed";
    voiceTurn.confirmedAt = createdAt;
    voiceTurn.attemptId = attempt.id;
  }
  const response = {
    session: privateTutorSessionView(session),
    snapshot: snapshotView(snapshot),
    answer: {
      correct: attempt.correct,
      independent: attempt.independent,
      usedHint: attempt.usedHint,
    },
    voiceTurn: privateTutorVoiceTurnView(voiceTurn),
    ...intelligence,
  };
  state.privateTutorIdempotencyRecords.unshift({
    id: nextId("pti"),
    ownerTeamId: learner.ownerTeamId,
    learnerId: learner.id,
    actorId,
    key: idempotencyKey,
    operation: "tutoring_session_answer",
    requestHash,
    attemptId: attempt.id,
    response,
    createdAt,
  });
  recordTutoringSessionEvent(state, {
    learner,
    actor,
    session,
    type: attempt.correct ? "answer_correct" : answerResult.advanced ? "activity_completed" : "answer_incorrect",
    details: { activity: attempt.activityKind, attemptId: attempt.id, voiceTurnId, usedHint: attempt.usedHint, independent: attempt.independent },
    now,
    nextId,
  });
  persistStateSoon();
  sendJson(res, 201, { ...response, replayed: false });
  return true;
}

function assessmentView(assessment) {
  if (!assessment) return null;
  return {
    id: assessment.id,
    learnerId: assessment.learnerId,
    status: assessment.status,
    revision: assessment.revision,
    startedAt: assessment.startedAt,
    pausedAt: assessment.pausedAt,
    completedAt: assessment.completedAt,
    activeSeconds: assessment.activeSeconds,
    targetSeconds: assessment.targetSeconds,
    minQuestions: assessment.minQuestions,
    maxQuestions: assessment.maxQuestions,
    answeredCount: assessment.answerSummaries.length,
    currentQuestion: assessment.currentQuestionRevisionId
      ? publicQuestion(privateTutorQuestion(assessment.currentQuestionRevisionId))
      : null,
    result: assessment.status === "completed" ? assessment.result : null,
    updatedAt: assessment.updatedAt,
  };
}

function applyDiagnosticResultToSnapshot(state, learner, assessment, { now, nextId }) {
  let snapshot = state.privateTutorSnapshots.find((row) => row.learnerId === learner.id);
  if (!snapshot) {
    snapshot = createInitialSnapshot(learner, { now, nextId });
    state.privateTutorSnapshots.unshift(snapshot);
  }
  for (const result of assessment.result.knowledge) {
    const current = snapshot.knowledge.find((row) => row.id === result.knowledgeId);
    if (!current) continue;
    current.mastery = result.mastery;
    current.level = result.level;
    current.evidenceCount += result.evidenceCount;
  }
  snapshot.revision += 1;
  snapshot.diagnosticCompletedAt = assessment.completedAt;
  snapshot.latestAssessmentId = assessment.id;
  snapshot.updatedAt = now();
}

function refreshPrivateTutorIntelligence(state, learner, {
  now,
  nextId,
  reason,
  carryForwardKnowledgeId = null,
}) {
  const snapshot = state.privateTutorSnapshots.find((row) => row.learnerId === learner.id);
  if (!snapshot) return currentPrivateTutorIntelligence(state, learner.id);
  const attempts = state.privateTutorAttempts.filter((row) => row.learnerId === learner.id);
  const previousModel = state.privateTutorLearnerModels.find((row) => row.learnerId === learner.id) ?? null;
  const previousDecision = state.privateTutorStrategyDecisions.find((row) => row.learnerId === learner.id) ?? null;
  const derived = derivePrivateTutorLearnerModel({ snapshot, attempts, now });
  const learnerModel = {
    id: nextId("ptm"),
    ownerTeamId: learner.ownerTeamId,
    learnerId: learner.id,
    revision: (previousModel?.revision ?? 0) + 1,
    sourceSnapshotRevision: snapshot.revision,
    reason,
    knowledge: derived.knowledge,
    createdAt: derived.at,
    updatedAt: derived.at,
  };
  state.privateTutorLearnerModels.unshift(learnerModel);

  const decisionValue = decidePrivateTutorStrategy({ model: learnerModel, attempts, previousDecision });
  if (!decisionValue) return currentPrivateTutorIntelligence(state, learner.id);
  const strategyDecision = {
    id: nextId("ptd"),
    ownerTeamId: learner.ownerTeamId,
    learnerId: learner.id,
    modelId: learnerModel.id,
    ...decisionValue,
    createdAt: now(),
  };
  state.privateTutorStrategyDecisions.unshift(strategyDecision);

  const planValue = buildPrivateTutorSevenDayPlan({
    model: learnerModel,
    decision: strategyDecision,
    now,
    reason,
    carryForwardKnowledgeId,
  });
  const previousPlan = state.privateTutorLearningPlans.find((row) => row.learnerId === learner.id) ?? null;
  const learningPlan = {
    id: nextId("ptp"),
    ownerTeamId: learner.ownerTeamId,
    learnerId: learner.id,
    modelId: learnerModel.id,
    decisionId: strategyDecision.id,
    revision: (previousPlan?.revision ?? 0) + 1,
    status: "active",
    ...planValue,
    updatedAt: planValue.generatedAt,
  };
  state.privateTutorLearningPlans.unshift(learningPlan);
  return {
    learnerModel: learnerModelView(learnerModel),
    strategyDecision: strategyDecisionView(strategyDecision),
    learningPlan: learningPlanView(learningPlan),
  };
}

function currentPrivateTutorIntelligence(state, learnerId) {
  return {
    learnerModel: learnerModelView(state.privateTutorLearnerModels.find((row) => row.learnerId === learnerId) ?? null),
    strategyDecision: strategyDecisionView(state.privateTutorStrategyDecisions.find((row) => row.learnerId === learnerId) ?? null),
    learningPlan: learningPlanView(state.privateTutorLearningPlans.find((row) => row.learnerId === learnerId) ?? null),
  };
}

function learnerModelView(model) {
  if (!model) return null;
  return {
    id: model.id,
    learnerId: model.learnerId,
    revision: model.revision,
    sourceSnapshotRevision: model.sourceSnapshotRevision,
    reason: model.reason,
    knowledge: model.knowledge.map((item) => ({
      id: item.id,
      title: item.title,
      mastery: item.mastery,
      level: item.level,
      confidence: item.confidence,
      evidenceCount: item.evidenceCount,
      independentCorrect: item.independentCorrect,
      hintedCorrect: item.hintedCorrect,
      incorrect: item.incorrect,
      hintDependency: item.hintDependency,
      latestEvidenceAt: item.latestEvidenceAt,
      forgettingRisk: item.forgettingRisk,
      misconception: item.misconception ? {
        id: item.misconception.id,
        label: item.misconception.label,
        evidenceCount: item.misconception.evidenceCount,
      } : null,
      prerequisiteId: item.prerequisiteId,
      prerequisiteGap: item.prerequisiteGap,
    })),
    updatedAt: model.updatedAt,
  };
}

function strategyDecisionView(decision) {
  if (!decision) return null;
  return {
    id: decision.id,
    learnerId: decision.learnerId,
    modelId: decision.modelId,
    targetKnowledgeId: decision.targetKnowledgeId,
    targetTitle: decision.targetTitle,
    strategy: decision.strategy,
    reasonCode: decision.reasonCode,
    studentReason: decision.studentReason,
    misconception: decision.misconception ? {
      id: decision.misconception.id,
      label: decision.misconception.label,
    } : null,
    exitConditions: [...decision.exitConditions],
    createdAt: decision.createdAt,
  };
}

function learningPlanView(plan) {
  if (!plan) return null;
  return {
    id: plan.id,
    learnerId: plan.learnerId,
    revision: plan.revision,
    status: plan.status,
    reason: plan.reason,
    studentReason: plan.studentReason,
    generatedAt: plan.generatedAt,
    days: plan.days.map((day) => ({ ...day })),
    updatedAt: plan.updatedAt,
  };
}

function elapsedSeconds(start, end) {
  const milliseconds = Date.parse(end) - Date.parse(start);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return 1;
  return Math.max(1, Math.ceil(milliseconds / 1000));
}

function ensureCollections(state) {
  for (const key of [
    "privateTutorLearners",
    "privateTutorGuardianLinks",
    "privateTutorSnapshots",
    "privateTutorAttempts",
    "privateTutorAssessments",
    "privateTutorLearnerModels",
    "privateTutorStrategyDecisions",
    "privateTutorLearningPlans",
    "privateTutorSessions",
    "privateTutorSessionEvents",
    "privateTutorVoiceTurns",
    "privateTutorVoiceEvents",
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
  const question = privateTutorQuestion(questionRevisionId);
  if (!question || question.context !== "practice" || question.knowledgeId !== knowledgeId) {
    return { ok: false, status: 400, body: { error: "invalid_private_tutor_attempt_reference" } };
  }
  const judgement = judgePrivateTutorAnswer(questionRevisionId, {
    rawAnswer: body?.rawAnswer,
    responseKind: body?.responseKind,
  });
  if (!judgement.accepted) {
    return { ok: false, status: 422, body: { error: judgement.error } };
  }
  return {
    ok: true,
    value: {
      idempotencyKey,
      knowledgeId,
      questionRevisionId,
      correct: judgement.correct,
      independent: body?.independent === true,
      usedHint: body?.usedHint === true,
      source,
      recognitionConfidence: Number.isFinite(recognitionConfidence) ? recognitionConfidence : null,
      responseKind: judgement.responseKind,
      normalizedAnswer: judgement.normalizedAnswer,
      judgementReason: judgement.reason,
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
    diagnosticCompletedAt: null,
    latestAssessmentId: null,
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
    "privateTutorAssessments",
    "privateTutorLearnerModels",
    "privateTutorStrategyDecisions",
    "privateTutorLearningPlans",
    "privateTutorSessions",
    "privateTutorSessionEvents",
    "privateTutorVoiceTurns",
    "privateTutorVoiceEvents",
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
    diagnosticCompletedAt: snapshot.diagnosticCompletedAt ?? null,
    latestAssessmentId: snapshot.latestAssessmentId ?? null,
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

function recordTutoringSessionEvent(state, { learner, actor, session, type, details, now, nextId }) {
  const event = {
    id: nextId("ptse"),
    ownerTeamId: learner.ownerTeamId,
    learnerId: learner.id,
    sessionId: session.id,
    actorId: actor?.userId ?? LOCAL_USER_ID,
    type,
    sessionRevision: session.revision,
    details,
    at: now(),
  };
  state.privateTutorSessionEvents.unshift(event);
  return event;
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
