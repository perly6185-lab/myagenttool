import { PRIVATE_TUTOR_LEARNER_COLLECTION_KEYS } from "./private-tutor-governance.mjs";

const MAX_DISCARD_IDS = 16;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function findOwnedProfile(state, ownerUserId, learnerId) {
  return state.privateTutorLearners.find((row) =>
    row.id === learnerId && row.status === "active" && row.createdBy === ownerUserId) ?? null;
}

function countLearnerEvidence(state, learnerId) {
  return {
    attempts: state.privateTutorAttempts.filter((row) => row.learnerId === learnerId).length,
    assessments: state.privateTutorAssessments.filter((row) => row.learnerId === learnerId).length,
    tutoringSessions: state.privateTutorSessions.filter((row) => row.learnerId === learnerId).length,
    reviewSchedules: state.privateTutorReviewSchedules.filter((row) => row.learnerId === learnerId).length,
    auditEvents: state.privateTutorAuditEvents.filter((row) => row.learnerId === learnerId).length,
  };
}

function profileCandidateView(state, learner) {
  const evidence = countLearnerEvidence(state, learner.id);
  return {
    learnerId: learner.id,
    displayName: learner.displayName,
    grade: learner.grade,
    createdAt: learner.createdAt,
    updatedAt: learner.updatedAt,
    evidence,
    evidenceTotal: Object.values(evidence).reduce((total, count) => total + count, 0),
  };
}

export function buildPrivateTutorProfileMigrationReport(state, actor) {
  const ownerUserId = actor?.userId ?? null;
  const profiles = state.privateTutorLearners.filter((row) => row.status === "active" && row.createdBy === ownerUserId);
  const candidates = profiles
    .map((learner) => profileCandidateView(state, learner))
    .sort((left, right) => right.evidenceTotal - left.evidenceTotal || String(left.createdAt).localeCompare(String(right.createdAt)));
  return {
    migrationRequired: candidates.length > 1,
    profileCount: candidates.length,
    candidates,
    recommendedKeepLearnerId: candidates[0]?.learnerId ?? null,
  };
}

export function mergeOwnedPrivateTutorProfiles(state, actor, input, { now, nextId }) {
  const ownerUserId = actor?.userId ?? null;
  if (!ownerUserId) return { ok: false, status: 403, body: { error: "private_tutor_profile_migration_forbidden" } };

  const keepLearnerId = String(input?.keepLearnerId ?? "").trim();
  const discardLearnerIds = Array.isArray(input?.discardLearnerIds)
    ? [...new Set(input.discardLearnerIds.map((id) => String(id ?? "").trim()))].filter(Boolean)
    : [];
  const dryRun = input?.dryRun === true;

  if (!keepLearnerId || !discardLearnerIds.length || discardLearnerIds.length > MAX_DISCARD_IDS || discardLearnerIds.includes(keepLearnerId)) {
    return { ok: false, status: 400, body: { error: "invalid_private_tutor_profile_migration" } };
  }

  const keepLearner = findOwnedProfile(state, ownerUserId, keepLearnerId);
  if (!keepLearner) return { ok: false, status: 404, body: { error: "private_tutor_learner_not_found" } };
  const discardLearners = [];
  for (const discardId of discardLearnerIds) {
    const discard = findOwnedProfile(state, ownerUserId, discardId);
    if (!discard) return { ok: false, status: 404, body: { error: "private_tutor_learner_not_found" } };
    discardLearners.push(discard);
  }

  const discardIdSet = new Set(discardLearnerIds);
  const rewrites = {};
  let rewrittenTotal = 0;
  for (const key of PRIVATE_TUTOR_LEARNER_COLLECTION_KEYS) {
    if (key === "privateTutorLearners") continue;
    const count = (state[key] ?? []).filter((row) => discardIdSet.has(row.learnerId)).length;
    if (count > 0) rewrites[key] = count;
    rewrittenTotal += count;
  }
  const cohortRewrites = state.privateTutorPilotCohorts
    .filter((row) => (row.enrolledLearnerIds ?? []).some((id) => discardIdSet.has(id))).length;
  const childModeSessionRewrites = (state.identitySessions ?? [])
    .filter((row) => discardIdSet.has(row.privateTutorChildMode?.learnerId)).length;

  const plan = {
    keepLearnerId,
    discardLearnerIds,
    dryRun,
    rewrites,
    rewrittenTotal,
    cohortRewrites,
    childModeSessionRewrites,
    discardedProfileCount: discardLearners.length,
    evidence: {
      keep: countLearnerEvidence(state, keepLearnerId),
      discard: discardLearnerIds.map((id) => ({ learnerId: id, ...countLearnerEvidence(state, id) })),
    },
  };

  if (dryRun) {
    return { ok: true, status: 200, body: { merged: false, dryRun: true, plan } };
  }

  const rollbackSnapshot = {};
  for (const key of PRIVATE_TUTOR_LEARNER_COLLECTION_KEYS) {
    rollbackSnapshot[key] = clone(state[key] ?? []);
  }
  rollbackSnapshot.privateTutorPilotCohorts = clone(state.privateTutorPilotCohorts ?? []);
  rollbackSnapshot.identityChildModeSessions = clone((state.identitySessions ?? [])
    .filter((row) => row.privateTutorChildMode?.learnerId)
    .map((row) => ({ id: row.id, learnerId: row.privateTutorChildMode.learnerId })));

  const appliedAt = now();
  for (const key of PRIVATE_TUTOR_LEARNER_COLLECTION_KEYS) {
    if (key === "privateTutorLearners") continue;
    for (const row of state[key] ?? []) {
      if (discardIdSet.has(row.learnerId)) row.learnerId = keepLearnerId;
    }
  }
  for (const cohort of state.privateTutorPilotCohorts ?? []) {
    if (!Array.isArray(cohort.enrolledLearnerIds)) continue;
    const remapped = cohort.enrolledLearnerIds.map((id) => (discardIdSet.has(id) ? keepLearnerId : id));
    cohort.enrolledLearnerIds = [...new Set(remapped)];
  }
  for (const session of state.identitySessions ?? []) {
    if (discardIdSet.has(session.privateTutorChildMode?.learnerId)) {
      session.privateTutorChildMode.learnerId = keepLearnerId;
    }
  }
  for (const discard of discardLearners) {
    discard.status = "merged";
    discard.mergedIntoLearnerId = keepLearnerId;
    discard.updatedAt = appliedAt;
  }
  keepLearner.updatedAt = appliedAt;

  const audit = {
    id: nextId("ptu"),
    ownerTeamId: keepLearner.ownerTeamId,
    learnerId: keepLearnerId,
    actorId: ownerUserId,
    action: "private_tutor_profile_merged",
    details: {
      keepLearnerId,
      discardLearnerIds,
      rewrittenTotal,
      rewrites,
      cohortRewrites,
      childModeSessionRewrites,
    },
    at: appliedAt,
  };
  state.privateTutorAuditEvents.unshift(audit);

  const rollbackReceipt = {
    id: nextId("ptmr"),
    keepLearnerId,
    discardLearnerIds,
    appliedAt,
    rewrittenTotal,
    rollbackCheck: {
      residualDiscardReferences: countDiscardResiduals(state, discardIdSet),
      expectedResidualDiscardReferences: discardLearners.length,
    },
  };

  return {
    ok: true,
    status: 200,
    body: {
      merged: true,
      dryRun: false,
      plan,
      audit,
      rollbackReceipt,
      rollbackSnapshot,
    },
  };
}

export function rollbackPrivateTutorProfileMerge(state, receipt, snapshot) {
  if (!receipt || !snapshot) return { ok: false, error: "invalid_private_tutor_profile_rollback" };
  const discardIdSet = new Set(receipt.discardLearnerIds ?? []);
  for (const key of PRIVATE_TUTOR_LEARNER_COLLECTION_KEYS) {
    if (!Array.isArray(snapshot[key])) continue;
    state[key] = clone(snapshot[key]);
  }
  if (Array.isArray(snapshot.privateTutorPilotCohorts)) {
    state.privateTutorPilotCohorts = clone(snapshot.privateTutorPilotCohorts);
  }
  const restored = new Map((snapshot.identityChildModeSessions ?? []).map((row) => [row.id, row.learnerId]));
  for (const session of state.identitySessions ?? []) {
    if (restored.has(session.id) && session.privateTutorChildMode) {
      session.privateTutorChildMode.learnerId = restored.get(session.id);
    }
  }
  return {
    ok: true,
    residualDiscardReferences: countDiscardResiduals(state, discardIdSet),
  };
}

function countDiscardResiduals(state, discardIdSet) {
  let residual = 0;
  for (const key of PRIVATE_TUTOR_LEARNER_COLLECTION_KEYS) {
    if (key === "privateTutorLearners") {
      residual += (state[key] ?? []).filter((row) => discardIdSet.has(row.id)).length;
      continue;
    }
    residual += (state[key] ?? []).filter((row) => discardIdSet.has(row.learnerId)).length;
  }
  residual += (state.privateTutorPilotCohorts ?? [])
    .filter((row) => (row.enrolledLearnerIds ?? []).some((id) => discardIdSet.has(id))).length;
  return residual;
}
