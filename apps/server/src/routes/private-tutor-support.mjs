import { createHash } from "node:crypto";
import { judgePrivateTutorAnswer, privateTutorQuestion, privateTutorSeedQuestionRevisions } from "../services/private-tutor-assessment.mjs";
import { seedPrivateTutorQuestionContent } from "../services/private-tutor-content.mjs";
import { privateTutorPackageRegistryFromState, seedPrivateTutorContentPackages } from "../services/private-tutor-package-registry.mjs";

const LOCAL_TEAM_ID = "team_local";
const LOCAL_USER_ID = "usr_local";
const MAX_NAME_LENGTH = 40;
const MAX_GRADE_LENGTH = 40;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const KNOWLEDGE_IDS = new Set(["integer", "equation-meaning", "balance", "word-problem"]);
const ATTEMPT_SOURCES = new Set(["screen", "voice_confirmed", "visual"]);
const DEFAULT_CONTENT_PACKAGE_ID = "demo-math-foundations-v1";

export function ensurePrivateTutorCollections(state) {
  for (const key of [
    "privateTutorLearners",
    "privateTutorGuardianLinks",
    "privateTutorSnapshots",
    "privateTutorAttempts",
    "privateTutorEvaluationReviews",
    "privateTutorGoldenCandidates",
    "privateTutorGoldenCandidateReviews",
    "privateTutorGoldenCandidateEvents",
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
    "privateTutorErrorCases",
    "privateTutorErrorThemes",
    "privateTutorReviewSchedules",
    "privateTutorGuardianPreferences",
    "privateTutorReleaseEvaluations",
    "privateTutorPilotCohorts",
    "privateTutorPilotParticipations",
    "privateTutorPilotConsents",
    "privateTutorPilotIncidents",
    "privateTutorPilotCheckIns",
    "privateTutorPilotDeletionRequests",
    "privateTutorQuestionRevisions",
    "privateTutorQuestionReviews",
    "privateTutorContentEvents",
    "privateTutorGuardianInvitations",
    "privateTutorDataPolicies",
    "privateTutorDeletionReports",
    "privateTutorDeletionJobs",
    "privateTutorContentPackages",
    "privateTutorModules",
    "privateTutorTopics",
    "privateTutorKnowledgeComponents",
    "privateTutorSubjectPlugins",
    "privateTutorMaterialDocuments",
    "privateTutorKnowledgeMapDrafts",
    "privateTutorRuntimeValidations",
    "privateTutorPackageActivations",
    "privateTutorContentMigrationPreviews",
    "privateTutorContentMigrationApplications",
    "privateTutorLearningTrials",
  ]) {
    if (!Array.isArray(state[key])) state[key] = [];
  }
  if (!state.privateTutorContentPackages?.length) {
    const seededAt = new Date(0).toISOString();
    seedPrivateTutorContentPackages(state, seededAt);
  }
  if (!state.privateTutorQuestionRevisions.length && !state.privateTutorContentEvents.length) {
    const seededAt = new Date(0).toISOString();
    seedPrivateTutorQuestionContent(state, privateTutorSeedQuestionRevisions(seededAt), seededAt);
  }
}

export function validatePrivateTutorLearnerInput(body) {
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

export function validatePrivateTutorAttemptInput(body, state, contentPackageId = null) {
  const idempotencyKey = String(body?.idempotencyKey ?? "").trim();
  const knowledgeId = String(body?.knowledgeId ?? "").trim();
  const questionRevisionId = String(body?.questionRevisionId ?? "").trim();
  const source = String(body?.source ?? "").trim();
  const recognitionConfidence = body?.recognitionConfidence == null ? null : Number(body.recognitionConfidence);
  const durationSeconds = Math.max(0, Math.min(1_800, Number(body?.durationSeconds ?? 0) || 0));
  if (!idempotencyKey || idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    return { ok: false, status: 400, body: { error: "invalid_private_tutor_idempotency_key" } };
  }
  const pkg = contentPackageId ? privateTutorPackageRegistryFromState(state).getPackage(contentPackageId) : null;
  const knowledgeIds = pkg ? new Set(pkg.knowledgeComponents.map((item) => item.id)) : KNOWLEDGE_IDS;
  if (!knowledgeIds.has(knowledgeId) || !questionRevisionId || questionRevisionId.length > 120) {
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
  const question = privateTutorQuestion(questionRevisionId, state, contentPackageId);
  if (!question || question.context !== "practice" || question.knowledgeId !== knowledgeId) {
    return { ok: false, status: 400, body: { error: "invalid_private_tutor_attempt_reference" } };
  }
  const judgement = judgePrivateTutorAnswer(questionRevisionId, {
    rawAnswer: body?.rawAnswer,
    responseKind: body?.responseKind,
    source,
    recognitionConfidence: Number.isFinite(recognitionConfidence) ? recognitionConfidence : null,
  }, state, contentPackageId);
  if (!judgement.accepted) {
    return { ok: false, status: 422, body: { error: judgement.error } };
  }
  return {
    ok: true,
    value: {
      idempotencyKey,
      contentPackageId: pkg?.id ?? null,
      contentPackageVersion: pkg?.version ?? null,
      subjectId: pkg?.subjectId ?? "math",
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
      evidenceEligible: judgement.evidenceEligible !== false,
      evidenceTier: judgement.evidenceTier ?? "deterministic",
      evaluation: judgement.evaluation ?? null,
      durationSeconds,
    },
  };
}

export function listAuthorizedPrivateTutorLearners(state, actor) {
  return state.privateTutorLearners
    .filter((learner) => findAuthorizedPrivateTutorLearner(state, actor, learner.id))
    .map(privateTutorLearnerView);
}

export function findAuthorizedPrivateTutorLearner(state, actor, learnerId, requiredPermission = "read") {
  const userId = actor?.userId ?? LOCAL_USER_ID;
  if (actor?.privateTutorLearnerId && actor.privateTutorLearnerId !== learnerId) return null;
  const learner = state.privateTutorLearners.find((row) =>
    row.id === learnerId && row.status === "active");
  if (!learner) return null;
  const link = state.privateTutorGuardianLinks.find((row) =>
    row.learnerId === learnerId
    && row.ownerTeamId === learner.ownerTeamId
    && row.guardianUserId === userId
    && row.verifiedAt);
  if (!link) return null;
  const permissions = new Set(link.permissions ?? []);
  const allowed = permissions.has("manage")
    || (requiredPermission === "read" && permissions.has("write"))
    || permissions.has(requiredPermission);
  return allowed ? learner : null;
}

export function createInitialPrivateTutorSnapshot(learner, { now, nextId, registry }) {
  const createdAt = now();
  const contentPackageId = learner.activePackageId ?? DEFAULT_CONTENT_PACKAGE_ID;
  const activePackage = registry?.getPackage(contentPackageId) ?? null;
  const knowledgeIds = activePackage?.knowledgeComponents?.map((kc) => kc.id) ?? ["integer", "equation-meaning", "balance", "word-problem"];
  return {
    id: nextId("pts"),
    ownerTeamId: learner.ownerTeamId,
    learnerId: learner.id,
    contentPackageId,
    contentPackageVersion: activePackage?.version ?? "1.0.0",
    packageStates: [],
    revision: 1,
    dailyMinutes: 0,
    completedSessions: 0,
    independentAnswers: 0,
    diagnosticCompletedAt: null,
    latestAssessmentId: null,
    knowledge: knowledgeIds.map((id) => ({ id, mastery: null, level: "unknown", evidenceCount: 0 })),
    updatedAt: createdAt,
  };
}

export function applyPrivateTutorAttemptToSnapshot(state, learner, attempt, { now, nextId }) {
  let snapshot = state.privateTutorSnapshots.find((row) => row.learnerId === learner.id);
  if (!snapshot) {
    snapshot = createInitialPrivateTutorSnapshot(learner, { now, nextId });
    state.privateTutorSnapshots.unshift(snapshot);
  }
  if (attempt.evidenceEligible === false) return snapshot;
  let knowledge = snapshot.knowledge.find((row) => row.id === attempt.knowledgeId);
  if (!knowledge) {
    knowledge = { id: attempt.knowledgeId, mastery: null, level: "unknown", evidenceCount: 0 };
    snapshot.knowledge.push(knowledge);
  }
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

export function privateTutorLearnerView(learner) {
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

export function privateTutorSnapshotView(snapshot) {
  if (!snapshot) return null;
  return {
    id: snapshot.id,
    learnerId: snapshot.learnerId,
    contentPackageId: snapshot.contentPackageId ?? DEFAULT_CONTENT_PACKAGE_ID,
    contentPackageVersion: snapshot.contentPackageVersion ?? "1.0.0",
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

export function switchPrivateTutorSnapshotPackage(snapshot, pkg, at) {
  if (!snapshot || !pkg) return null;
  const currentPackageId = snapshot.contentPackageId ?? DEFAULT_CONTENT_PACKAGE_ID;
  const currentVersion = snapshot.contentPackageVersion ?? "1.0.0";
  if (!Array.isArray(snapshot.packageStates)) snapshot.packageStates = [];

  const currentState = {
    packageId: currentPackageId,
    packageVersion: currentVersion,
    knowledge: structuredClone(snapshot.knowledge ?? []),
    diagnosticCompletedAt: snapshot.diagnosticCompletedAt ?? null,
    latestAssessmentId: snapshot.latestAssessmentId ?? null,
    updatedAt: at,
  };
  const currentIndex = snapshot.packageStates.findIndex((row) => row.packageId === currentPackageId && row.packageVersion === currentVersion);
  if (currentIndex >= 0) snapshot.packageStates[currentIndex] = currentState;
  else snapshot.packageStates.push(currentState);

  const target = snapshot.packageStates.find((row) => row.packageId === pkg.id && row.packageVersion === pkg.version);
  snapshot.contentPackageId = pkg.id;
  snapshot.contentPackageVersion = pkg.version;
  snapshot.knowledge = target
    ? structuredClone(target.knowledge)
    : pkg.knowledgeComponents.map((item) => ({ id: item.id, mastery: null, level: "unknown", evidenceCount: 0 }));
  snapshot.diagnosticCompletedAt = target?.diagnosticCompletedAt ?? null;
  snapshot.latestAssessmentId = target?.latestAssessmentId ?? null;
  snapshot.revision += 1;
  snapshot.updatedAt = at;
  return snapshot;
}

export function recordPrivateTutorAudit(state, { learner, actor, action, details, now, nextId }) {
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

export function recordPrivateTutorSessionEvent(state, { learner, actor, session, type, details, now, nextId }) {
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

export function recordPrivateTutorDeniedAccess(state, { learnerId, actor, method, resource, now, nextId }) {
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

export function stablePrivateTutorHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function privateTutorChildModeView(actor) {
  return actor?.privateTutorLearnerId ? {
    active: true,
    learnerId: actor.privateTutorLearnerId,
    enteredAt: actor.privateTutorChildModeEnteredAt,
  } : { active: false, learnerId: null, enteredAt: null };
}

export function privateTutorLearnerNotFound() {
  return { error: "private_tutor_learner_not_found" };
}
