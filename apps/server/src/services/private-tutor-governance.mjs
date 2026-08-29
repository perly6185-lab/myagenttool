import { createHash, randomBytes } from "node:crypto";

export const PRIVATE_TUTOR_LEARNER_COLLECTION_KEYS = [
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
  "privateTutorRoadmapLedgers",
  "privateTutorTeachingStrategyDecisions",
  "privateTutorExperienceEvents",
  "privateTutorPackageActivations",
  "privateTutorContentMigrationPreviews",
  "privateTutorContentMigrationApplications",
  "privateTutorRuntimeValidations",
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
  "privateTutorGuardianInvitations",
  "privateTutorDataPolicies",
  "privateTutorPilotParticipations",
  "privateTutorPilotConsents",
  "privateTutorPilotIncidents",
  "privateTutorPilotCheckIns",
  "privateTutorPilotDeletionRequests",
  "privateTutorLearningTrials",
  "privateTutorLearningPreferences",
];

const TRANSCRIPT_RETENTION_DAYS = new Set([0, 7, 30, 90, 365]);
const DERIVED_RETENTION_DAYS = new Set([180, 365, 730]);

export function createPrivateTutorGuardianInvitation(state, learner, input, { actorId, now, nextId }) {
  const inviteeLabel = String(input?.inviteeLabel ?? "").trim().slice(0, 80) || null;
  const permissions = normalizePermissions(input?.permissions);
  if (!permissions) return { ok: false, status: 400, error: "invalid_private_tutor_guardian_invitation" };
  const rawToken = randomBytes(24).toString("base64url");
  const createdAt = now();
  const invitation = {
    id: nextId("ptgi"),
    ownerTeamId: learner.ownerTeamId,
    learnerId: learner.id,
    invitedBy: actorId,
    inviteeLabel,
    permissions,
    tokenHash: tokenHash(rawToken),
    status: "pending",
    createdAt,
    expiresAt: addDays(createdAt, 7),
    acceptedBy: null,
    acceptedAt: null,
  };
  state.privateTutorGuardianInvitations.unshift(invitation);
  return {
    ok: true,
    invitation: guardianInvitationView(invitation),
    invitationToken: rawToken,
  };
}

export function listPrivateTutorGuardianInvitations(state, learnerId) {
  return state.privateTutorGuardianInvitations
    .filter((row) => row.learnerId === learnerId)
    .map(guardianInvitationView);
}

export function acceptPrivateTutorGuardianInvitation(state, rawToken, { actor, now, nextId }) {
  const hash = tokenHash(String(rawToken ?? ""));
  const invitation = state.privateTutorGuardianInvitations.find((row) => row.tokenHash === hash);
  if (!invitation || invitation.status !== "pending") return { ok: false, status: 404, error: "private_tutor_guardian_invitation_not_found" };
  const acceptedAt = now();
  if (Date.parse(invitation.expiresAt) <= Date.parse(acceptedAt)) {
    invitation.status = "expired";
    return { ok: false, status: 410, error: "private_tutor_guardian_invitation_expired", changed: true };
  }
  const learner = state.privateTutorLearners.find((row) => row.id === invitation.learnerId && row.status === "active");
  if (!learner) return { ok: false, status: 404, error: "private_tutor_guardian_invitation_not_found" };
  let link = state.privateTutorGuardianLinks.find((row) => row.learnerId === learner.id && row.guardianUserId === actor.userId);
  if (!link) {
    link = {
      id: nextId("grd"),
      ownerTeamId: learner.ownerTeamId,
      learnerId: learner.id,
      guardianUserId: actor.userId,
      relationship: "guardian",
      permissions: [...invitation.permissions],
      verifiedAt: acceptedAt,
      createdAt: acceptedAt,
      invitationId: invitation.id,
    };
    state.privateTutorGuardianLinks.unshift(link);
  }
  invitation.status = "accepted";
  invitation.acceptedBy = actor.userId;
  invitation.acceptedAt = acceptedAt;
  return { ok: true, learner, guardianLink: { ...link }, invitation: guardianInvitationView(invitation) };
}

export function privateTutorDataPolicy(state, learner, guardianUserId) {
  const saved = state.privateTutorDataPolicies.find((row) => row.learnerId === learner.id);
  return saved ? { ...defaultPolicy(learner, guardianUserId), ...saved } : defaultPolicy(learner, guardianUserId);
}

export function updatePrivateTutorDataPolicy(state, learner, guardianUserId, input, { now, nextId }) {
  const voiceTranscriptDays = Number(input?.voiceTranscriptDays);
  const derivedProfileHistoryDays = Number(input?.derivedProfileHistoryDays);
  if (!TRANSCRIPT_RETENTION_DAYS.has(voiceTranscriptDays) || !DERIVED_RETENTION_DAYS.has(derivedProfileHistoryDays)
    || (input?.rawAudioDays != null && Number(input.rawAudioDays) !== 0)
    || (input?.learningEvidenceRetention != null && input.learningEvidenceRetention !== "until_learner_deletion")) {
    return { ok: false, error: "invalid_private_tutor_data_policy" };
  }
  const updatedAt = now();
  let policy = state.privateTutorDataPolicies.find((row) => row.learnerId === learner.id);
  if (!policy) {
    policy = { ...defaultPolicy(learner, guardianUserId), id: nextId("ptdp"), createdAt: updatedAt };
    state.privateTutorDataPolicies.unshift(policy);
  }
  policy.voiceTranscriptDays = voiceTranscriptDays;
  policy.derivedProfileHistoryDays = derivedProfileHistoryDays;
  policy.rawAudioDays = 0;
  policy.learningEvidenceRetention = "until_learner_deletion";
  policy.updatedBy = guardianUserId;
  policy.updatedAt = updatedAt;
  return { ok: true, policy: { ...policy } };
}

export function applyPrivateTutorDataRetention(state, { now, nextId }) {
  const at = now();
  let reaped = 0;
  for (const learner of state.privateTutorLearners) {
    const policy = privateTutorDataPolicy(state, learner, "system");
    const transcriptCutoff = subtractDays(at, policy.voiceTranscriptDays);
    for (const key of ["privateTutorVoiceTurns", "privateTutorVoiceEvents"]) {
      const before = state[key].length;
      state[key] = state[key].filter((row) => row.learnerId !== learner.id || !olderThan(row.createdAt, transcriptCutoff));
      reaped += before - state[key].length;
    }

    const derivedCutoff = subtractDays(at, policy.derivedProfileHistoryDays);
    const protectedDecisionIds = new Set(state.privateTutorLearningPlans.filter((row) => row.learnerId === learner.id).map((row) => row.decisionId).filter(Boolean));
    const latestDecisionId = state.privateTutorStrategyDecisions.find((row) => row.learnerId === learner.id)?.id;
    if (latestDecisionId) protectedDecisionIds.add(latestDecisionId);
    const decisionsBefore = state.privateTutorStrategyDecisions.length;
    state.privateTutorStrategyDecisions = state.privateTutorStrategyDecisions.filter((row) =>
      row.learnerId !== learner.id || protectedDecisionIds.has(row.id) || !olderThan(row.createdAt, derivedCutoff));
    reaped += decisionsBefore - state.privateTutorStrategyDecisions.length;

    const protectedModelIds = new Set(state.privateTutorStrategyDecisions.filter((row) => row.learnerId === learner.id).map((row) => row.modelId).filter(Boolean));
    const latestModelId = state.privateTutorLearnerModels.find((row) => row.learnerId === learner.id)?.id;
    if (latestModelId) protectedModelIds.add(latestModelId);
    const modelsBefore = state.privateTutorLearnerModels.length;
    state.privateTutorLearnerModels = state.privateTutorLearnerModels.filter((row) =>
      row.learnerId !== learner.id || protectedModelIds.has(row.id) || !olderThan(row.updatedAt ?? row.createdAt, derivedCutoff));
    reaped += modelsBefore - state.privateTutorLearnerModels.length;

    const latestTeachingDecisionId = state.privateTutorTeachingStrategyDecisions.find((row) => row.learnerId === learner.id)?.id;
    const teachingDecisionsBefore = state.privateTutorTeachingStrategyDecisions.length;
    state.privateTutorTeachingStrategyDecisions = state.privateTutorTeachingStrategyDecisions.filter((row) =>
      row.learnerId !== learner.id || row.id === latestTeachingDecisionId || !olderThan(row.createdAt, derivedCutoff));
    reaped += teachingDecisionsBefore - state.privateTutorTeachingStrategyDecisions.length;

    const experienceEventsBefore = state.privateTutorExperienceEvents.length;
    state.privateTutorExperienceEvents = state.privateTutorExperienceEvents.filter((row) =>
      row.learnerId !== learner.id || !olderThan(row.createdAt, derivedCutoff));
    reaped += experienceEventsBefore - state.privateTutorExperienceEvents.length;
  }
  if (reaped > 0) {
    state.privateTutorAuditEvents.unshift({
      id: nextId("ptu"),
      ownerTeamId: "system",
      learnerId: null,
      actorId: "system",
      action: "private_tutor_retention_applied",
      details: { reaped },
      at,
    });
  }
  return { reaped, at };
}

export function buildPrivateTutorLearnerExport(state, learner, at) {
  const collections = {};
  for (const key of PRIVATE_TUTOR_LEARNER_COLLECTION_KEYS) {
    if (["privateTutorLearners", "privateTutorGuardianInvitations"].includes(key)) continue;
    collections[key] = clone(state[key].filter((row) => row.learnerId === learner.id));
  }
  collections.privateTutorGuardianInvitations = state.privateTutorGuardianInvitations
    .filter((row) => row.learnerId === learner.id)
    .map(guardianInvitationView);
  return {
    schemaVersion: 1,
    exportType: "private_tutor_learner_data",
    generatedAt: at,
    learner: clone(learner),
    dataPolicy: privateTutorDataPolicy(state, learner, "export"),
    collections,
    exclusions: ["guardian invitation secrets", "global answer keys", "other learners"],
  };
}

export function previewPrivateTutorLearnerDeletion(state, learner) {
  const collectionCounts = {};
  let totalRecords = 0;
  for (const key of PRIVATE_TUTOR_LEARNER_COLLECTION_KEYS) {
    const count = state[key].filter((row) => row.learnerId === learner.id || (key === "privateTutorLearners" && row.id === learner.id)).length;
    collectionCounts[key] = count;
    totalRecords += count;
  }
  const cohortEnrollmentCount = state.privateTutorPilotCohorts.filter((row) => row.enrolledLearnerIds?.includes(learner.id)).length;
  collectionCounts.privateTutorPilotCohortEnrollments = cohortEnrollmentCount;
  totalRecords += cohortEnrollmentCount;
  const childModeSessionCount = (state.identitySessions ?? []).filter((row) => row.privateTutorChildMode?.learnerId === learner.id).length;
  collectionCounts.privateTutorChildModeSessions = childModeSessionCount;
  totalRecords += childModeSessionCount;
  return {
    learnerId: learner.id,
    totalRecords,
    collectionCounts,
    retainedAfterDeletion: ["PII-scrubbed deletion report", "hashed audit tombstone"],
    requiresExactDisplayName: true,
  };
}

export function preparePrivateTutorLearnerDeletion(state, learner, { actorId, now, nextId }) {
  const preview = previewPrivateTutorLearnerDeletion(state, learner);
  const requestedAt = now();
  const subjectHash = createHash("sha256").update(`private-tutor:${learner.id}`).digest("hex");
  const report = {
    id: nextId("ptdr"),
    ownerTeamId: learner.ownerTeamId,
    subjectHash,
    actorId,
    status: "pending_erasure",
    requestedAt,
    deletedAt: null,
    deletedRecordCount: preview.totalRecords,
    collectionCounts: preview.collectionCounts,
    liveStateResidualCount: preview.totalRecords,
    durableVerification: null,
  };
  const job = {
    id: nextId("ptdj"),
    reportId: report.id,
    ownerTeamId: learner.ownerTeamId,
    subjectId: learner.id,
    subjectHash,
    requestedBy: actorId,
    status: "pending_erasure",
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
    createdAt: requestedAt,
    updatedAt: requestedAt,
    completedAt: null,
  };
  report.deletionJobId = job.id;
  state.privateTutorDeletionReports.unshift(report);
  state.privateTutorDeletionJobs.unshift(job);
  state.privateTutorAuditEvents.unshift({
    id: nextId("ptu"),
    ownerTeamId: learner.ownerTeamId,
    learnerId: `deleted:${subjectHash.slice(0, 16)}`,
    actorId,
    action: "learner_deletion_requested",
    details: { deletionReportId: report.id, deletionJobId: job.id, deletedRecordCount: preview.totalRecords },
    at: requestedAt,
  });
  return { report, job };
}

export function erasePrivateTutorLearnerData(state, learnerId, report, at) {
  for (const key of PRIVATE_TUTOR_LEARNER_COLLECTION_KEYS) {
    state[key] = state[key].filter((row) => row.learnerId !== learnerId && !(key === "privateTutorLearners" && row.id === learnerId));
  }
  for (const cohort of state.privateTutorPilotCohorts) {
    cohort.enrolledLearnerIds = (cohort.enrolledLearnerIds ?? []).filter((id) => id !== learnerId);
  }
  for (const session of state.identitySessions ?? []) {
    if (session.privateTutorChildMode?.learnerId === learnerId) delete session.privateTutorChildMode;
  }
  report.status = "logically_deleted";
  report.deletedAt ??= at;
  report.liveStateResidualCount = countLearnerResiduals(state, learnerId);
  return report;
}

export function deletePrivateTutorLearnerData(state, learner, context) {
  const prepared = preparePrivateTutorLearnerDeletion(state, learner, context);
  return erasePrivateTutorLearnerData(state, learner.id, prepared.report, context.now());
}

export function countLearnerResiduals(state, learnerId) {
  const direct = PRIVATE_TUTOR_LEARNER_COLLECTION_KEYS.reduce((total, key) =>
    total + state[key].filter((row) => row.learnerId === learnerId || (key === "privateTutorLearners" && row.id === learnerId)).length, 0);
  const childModeSessions = (state.identitySessions ?? []).filter((row) => row.privateTutorChildMode?.learnerId === learnerId).length;
  return direct
    + state.privateTutorPilotCohorts.filter((row) => row.enrolledLearnerIds?.includes(learnerId)).length
    + childModeSessions;
}

function defaultPolicy(learner, guardianUserId) {
  return {
    id: null,
    learnerId: learner.id,
    ownerTeamId: learner.ownerTeamId,
    rawAudioDays: 0,
    voiceTranscriptDays: 30,
    derivedProfileHistoryDays: 365,
    learningEvidenceRetention: "until_learner_deletion",
    updatedBy: guardianUserId,
    createdAt: null,
    updatedAt: null,
  };
}

function guardianInvitationView(invitation) {
  const { tokenHash: _tokenHash, ...view } = invitation;
  return clone(view);
}

function normalizePermissions(value) {
  const requested = Array.isArray(value) ? value.map((item) => String(item)) : ["read", "write", "manage"];
  if (!requested.length || requested.some((item) => !["read", "write", "manage"].includes(item))) return null;
  return [...new Set(requested)];
}

function tokenHash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function addDays(at, days) {
  return new Date(Date.parse(at) + days * 86_400_000).toISOString();
}

function subtractDays(at, days) {
  return new Date(Date.parse(at) - days * 86_400_000).toISOString();
}

function olderThan(value, cutoff) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed < Date.parse(cutoff);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
