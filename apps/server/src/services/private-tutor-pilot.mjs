import { createHash } from "node:crypto";

const INCIDENT_CATEGORIES = new Set(["content_error", "voice_misrecognition", "child_distress", "privacy", "access", "other"]);
const PRESSURE_LEVELS = new Set(["low", "manageable", "high"]);
const WILLINGNESS_LEVELS = new Set(["yes", "unsure", "no"]);
const ACKNOWLEDGEMENT_KEYS = ["guardianAuthority", "scopeUnderstood", "dataUseUnderstood", "voluntaryParticipation", "withdrawalUnderstood", "childWillingnessDiscussed"];

const CONSENT_DOCUMENT_SOURCE = {
  id: "pt-consent-2026-08-21-v1",
  version: "2026-08-21.v1",
  effectiveAt: "2026-08-21T00:00:00.000Z",
  title: "“我的私教”7 天受控试点知情同意说明",
  summary: "本试点仅验证受控范围内的数学学习体验。加入完全自愿，家长可随时退出，并可另行申请删除孩子数据。",
  terms: [
    { id: "scope", label: "试点固定为 7 天，只用于约定范围内的数学学习与安全评估。" },
    { id: "data", label: "记录必要的学习证据、语音转写和安全事件；原始音频不保存，不采集排名或人格标签。" },
    { id: "voluntary", label: "加入完全自愿，不同意或退出不会产生惩罚，也不会由专业人员代替家长同意。" },
    { id: "withdrawal", label: "家长可随时主动退出；退出立即停止新的试点学习写入，删除数据需要单独确认。" },
    { id: "safety", label: "家长可报告内容、语音、儿童情绪、隐私或访问异常；严重事件会升级，重大事件自动暂停试点。" },
  ],
};

// Append new immutable documents here; never mutate or remove a version that a
// persisted cohort may still reference.
const CONSENT_DOCUMENTS = Object.freeze([CONSENT_DOCUMENT_SOURCE].map((source) => Object.freeze({
  ...source,
  terms: Object.freeze(source.terms.map((term) => Object.freeze({ ...term }))),
  checksum: createHash("sha256").update(JSON.stringify(source)).digest("hex"),
})));
const CURRENT_CONSENT_DOCUMENT = CONSENT_DOCUMENTS.at(-1);

export function currentPrivateTutorPilotConsentDocument() {
  return clone(CURRENT_CONSENT_DOCUMENT);
}

export function privateTutorPilotGuardianStatus(state, learnerId) {
  const openCohort = currentCohort(state);
  const openParticipation = openCohort
    ? state.privateTutorPilotParticipations.find((row) => row.cohortId === openCohort.id && row.learnerId === learnerId) ?? null
    : null;
  const participation = openParticipation ?? (!openCohort
    ? state.privateTutorPilotParticipations.find((row) => row.learnerId === learnerId) ?? null
    : null);
  const cohort = openCohort ?? (participation ? state.privateTutorPilotCohorts.find((row) => row.id === participation.cohortId) ?? null : null);
  const consent = participation
    ? state.privateTutorPilotConsents.find((row) => row.id === participation.consentId) ?? null
    : null;
  return {
    cohort: cohort ? cohortView(cohort) : null,
    consentDocument: cohort ? clone(consentDocumentForCohort(cohort)) : null,
    participation: participation ? clone(participation) : null,
    consent: consent ? clone(consent) : null,
    incidents: cohort ? clone(state.privateTutorPilotIncidents.filter((row) => row.cohortId === cohort.id && row.learnerId === learnerId)) : [],
    checkIns: cohort ? clone(state.privateTutorPilotCheckIns.filter((row) => row.cohortId === cohort.id && row.learnerId === learnerId)) : [],
    deletionRequests: cohort ? clone(state.privateTutorPilotDeletionRequests.filter((row) => row.cohortId === cohort.id && row.learnerId === learnerId)) : [],
    canJoin: Boolean(openCohort?.status === "active" && !openParticipation),
  };
}

export function applyPrivateTutorPilotLifecycle(state, at) {
  let completed = 0;
  for (const cohort of state.privateTutorPilotCohorts) {
    const endsAt = Date.parse(cohort.endsAt);
    if (!["active", "paused"].includes(cohort.status) || !Number.isFinite(endsAt) || endsAt > Date.parse(at)) continue;
    Object.assign(cohort, { status: "completed", completedAt: at, completionReason: "duration_elapsed" });
    for (const participation of state.privateTutorPilotParticipations.filter((row) => row.cohortId === cohort.id && row.status === "active")) {
      Object.assign(participation, { status: "completed", completedAt: at });
    }
    completed += 1;
  }
  return { completed };
}

export function acceptPrivateTutorPilotConsent(state, learner, input, { actor, now, nextId, releaseReady = true }) {
  if (!releaseReady) return failure(409, "private_tutor_release_gates_blocked");
  const cohort = state.privateTutorPilotCohorts.find((row) => row.id === String(input?.cohortId ?? "") && row.status === "active");
  if (!cohort) return failure(409, "private_tutor_pilot_not_accepting_participants");
  const consentDocument = consentDocumentForCohort(cohort);
  if (!consentDocument || String(input?.consentDocumentId ?? "") !== consentDocument.id) {
    return failure(409, "private_tutor_pilot_consent_version_mismatch");
  }
  const existing = state.privateTutorPilotParticipations.find((row) => row.cohortId === cohort.id && row.learnerId === learner.id);
  if (existing) return failure(409, existing.status === "withdrawn" ? "private_tutor_pilot_withdrawal_is_final" : "private_tutor_pilot_already_enrolled");
  const acknowledgements = normalizeAcknowledgements(input?.acknowledgements);
  if (!acknowledgements) return failure(400, "private_tutor_pilot_consent_incomplete");
  const uniqueParticipants = new Set(state.privateTutorPilotParticipations.filter((row) => row.cohortId === cohort.id).map((row) => row.learnerId));
  if (uniqueParticipants.size >= cohort.participantTarget) return failure(409, "private_tutor_pilot_capacity_reached");

  const acceptedAt = now();
  const participationId = nextId("ptpp");
  const consent = {
    id: nextId("ptcn"), ownerTeamId: learner.ownerTeamId, cohortId: cohort.id, participationId,
    learnerId: learner.id, guardianUserId: actor.userId, documentId: consentDocument.id,
    documentVersion: consentDocument.version, documentChecksum: consentDocument.checksum,
    acknowledgements, acceptedAt,
  };
  const participation = {
    id: participationId, ownerTeamId: learner.ownerTeamId, cohortId: cohort.id, learnerId: learner.id,
    status: "active", consentId: consent.id, enrolledBy: actor.userId, enrolledAt: acceptedAt,
    withdrawnAt: null, withdrawalReason: null,
  };
  state.privateTutorPilotConsents.unshift(consent);
  state.privateTutorPilotParticipations.unshift(participation);
  cohort.enrolledLearnerIds = [...new Set([...(cohort.enrolledLearnerIds ?? []), learner.id])];
  return { ok: true, participation: clone(participation), consent: clone(consent) };
}

export function withdrawPrivateTutorPilotParticipation(state, learner, input, { actor, now, nextId }) {
  const participation = state.privateTutorPilotParticipations.find((row) => row.learnerId === learner.id && row.status === "active");
  if (!participation) return failure(404, "private_tutor_pilot_participation_not_found");
  const reason = String(input?.reason ?? "guardian_choice");
  if (!["guardian_choice", "child_choice", "safety_concern", "privacy_concern", "other"].includes(reason)) {
    return failure(400, "invalid_private_tutor_pilot_withdrawal");
  }
  const withdrawnAt = now();
  Object.assign(participation, { status: "withdrawn", withdrawnAt, withdrawalReason: reason, withdrawnBy: actor.userId });
  const cohort = state.privateTutorPilotCohorts.find((row) => row.id === participation.cohortId);
  if (cohort) cohort.enrolledLearnerIds = (cohort.enrolledLearnerIds ?? []).filter((id) => id !== learner.id);
  let deletionRequest = null;
  if (input?.deletionRequested === true) {
    deletionRequest = {
      id: nextId("ptpd"), ownerTeamId: learner.ownerTeamId, cohortId: participation.cohortId,
      participationId: participation.id, learnerId: learner.id, requestedBy: actor.userId,
      status: "pending_parent_confirmation", requestedAt: withdrawnAt,
    };
    state.privateTutorPilotDeletionRequests.unshift(deletionRequest);
  }
  return { ok: true, participation: clone(participation), deletionRequest: clone(deletionRequest) };
}

export function recordPrivateTutorPilotCheckIn(state, learner, input, { actor, now, nextId }) {
  const participation = activeParticipation(state, learner.id);
  if (!participation) return failure(409, "private_tutor_pilot_active_participation_required");
  const pressure = String(input?.guardianPressure ?? "");
  const willingness = String(input?.childWillingToReturn ?? "");
  if (!PRESSURE_LEVELS.has(pressure) || !WILLINGNESS_LEVELS.has(willingness)) return failure(400, "invalid_private_tutor_pilot_check_in");
  const createdAt = now();
  const day = createdAt.slice(0, 10);
  if (state.privateTutorPilotCheckIns.some((row) => row.participationId === participation.id && row.guardianUserId === actor.userId && row.day === day)) {
    return failure(409, "private_tutor_pilot_daily_check_in_exists");
  }
  const checkIn = {
    id: nextId("ptci"), ownerTeamId: learner.ownerTeamId, cohortId: participation.cohortId,
    participationId: participation.id, learnerId: learner.id, guardianUserId: actor.userId,
    guardianPressure: pressure, childWillingToReturn: willingness, day, createdAt,
  };
  state.privateTutorPilotCheckIns.unshift(checkIn);
  return { ok: true, checkIn: clone(checkIn) };
}

export function reportPrivateTutorPilotIncident(state, learner, input, { actor, now, nextId }) {
  const participation = state.privateTutorPilotParticipations.find((row) => row.learnerId === learner.id);
  if (!participation) return failure(409, "private_tutor_pilot_participation_required");
  const category = String(input?.category ?? "");
  const severity = guardianIncidentSeverity(category, input?.needsImmediateStop === true);
  const summary = String(input?.summary ?? "").trim();
  if (!INCIDENT_CATEGORIES.has(category) || summary.length < 5 || summary.length > 500) {
    return failure(400, "invalid_private_tutor_pilot_incident");
  }
  const createdAt = now();
  const escalated = ["high", "critical"].includes(severity);
  const incident = {
    id: nextId("ptin"), ownerTeamId: learner.ownerTeamId, cohortId: participation.cohortId,
    participationId: participation.id, learnerId: learner.id, reportedBy: actor.userId,
    category, severity, summary, status: escalated ? "escalated" : "open", assignedTo: null,
    createdAt, escalatedAt: escalated ? createdAt : null, resolvedAt: null, resolution: null,
  };
  state.privateTutorPilotIncidents.unshift(incident);
  let cohort = state.privateTutorPilotCohorts.find((row) => row.id === participation.cohortId) ?? null;
  if (severity === "critical" && cohort && cohort.status === "active") {
    pauseCohort(cohort, { actorId: "system", reason: `critical_incident:${incident.id}`, at: createdAt });
  }
  return { ok: true, incident: clone(incident), cohort: cohort ? cohortView(cohort) : null };
}

export function pausePrivateTutorPilotCohort(state, cohortId, input, { actor, now }) {
  const cohort = state.privateTutorPilotCohorts.find((row) => row.id === cohortId);
  const reason = String(input?.reason ?? "").trim();
  if (!cohort || cohort.status !== "active") return failure(409, "private_tutor_pilot_not_active");
  if (reason.length < 5 || reason.length > 500) return failure(400, "invalid_private_tutor_pilot_pause");
  pauseCohort(cohort, { actorId: actor.userId, reason, at: now() });
  return { ok: true, cohort: cohortView(cohort) };
}

export function resumePrivateTutorPilotCohort(state, cohortId, input, { actor, now, releaseReady = true }) {
  const cohort = state.privateTutorPilotCohorts.find((row) => row.id === cohortId);
  const reason = String(input?.reason ?? "").trim();
  if (!cohort || cohort.status !== "paused") return failure(409, "private_tutor_pilot_not_paused");
  if (!releaseReady) return failure(409, "private_tutor_release_gates_blocked");
  if (state.privateTutorPilotIncidents.some((row) => row.cohortId === cohort.id && row.severity === "critical" && row.status !== "resolved")) {
    return failure(409, "private_tutor_pilot_critical_incident_open");
  }
  if (reason.length < 5 || reason.length > 500) return failure(400, "invalid_private_tutor_pilot_resume");
  Object.assign(cohort, { status: "active", resumedAt: now(), resumedBy: actor.userId, resumeReason: reason });
  return { ok: true, cohort: cohortView(cohort) };
}

export function updatePrivateTutorPilotIncident(state, incidentId, input, { actor, now }) {
  const incident = state.privateTutorPilotIncidents.find((row) => row.id === incidentId);
  if (!incident) return failure(404, "private_tutor_pilot_incident_not_found");
  const action = String(input?.action ?? "");
  if (action === "escalate") {
    incident.status = "escalated";
    incident.escalatedAt ??= now();
    incident.assignedTo = String(input?.assignedTo ?? actor.userId).trim().slice(0, 120) || actor.userId;
  } else if (action === "resolve") {
    const resolution = String(input?.resolution ?? "").trim();
    if (resolution.length < 5 || resolution.length > 500) return failure(400, "invalid_private_tutor_pilot_incident_resolution");
    incident.status = "resolved";
    incident.resolution = resolution;
    incident.resolvedAt = now();
    incident.resolvedBy = actor.userId;
  } else {
    return failure(400, "invalid_private_tutor_pilot_incident_action");
  }
  return { ok: true, incident: clone(incident) };
}

export function privateTutorPilotOperations(state, now) {
  return {
    cohorts: state.privateTutorPilotCohorts.map(cohortView),
    incidents: clone(state.privateTutorPilotIncidents),
    metrics: state.privateTutorPilotCohorts.map((cohort) => aggregateCohort(state, cohort, now)),
    consentDocument: currentPrivateTutorPilotConsentDocument(),
  };
}

export function privateTutorPilotPauseForLearner(state, learnerId) {
  const participation = activeParticipation(state, learnerId);
  if (!participation) return null;
  const cohort = state.privateTutorPilotCohorts.find((row) => row.id === participation.cohortId && row.status === "paused");
  return cohort ? { cohortId: cohort.id, reason: cohort.pauseReason, pausedAt: cohort.pausedAt } : null;
}

function aggregateCohort(state, cohort, at) {
  const participations = state.privateTutorPilotParticipations.filter((row) => row.cohortId === cohort.id);
  const byLearner = new Map(participations.map((row) => [row.learnerId, row]));
  const inWindow = (row) => {
    const participation = byLearner.get(row.learnerId);
    if (!participation) return false;
    const timestamp = Date.parse(row.completedAt ?? row.createdAt ?? row.updatedAt);
    return timestamp >= Date.parse(participation.enrolledAt) && (!participation.withdrawnAt || timestamp <= Date.parse(participation.withdrawnAt));
  };
  const sessions = state.privateTutorSessions.filter((row) => row.status === "completed" && inWindow(row));
  const attempts = state.privateTutorAttempts.filter(inWindow);
  const checkIns = state.privateTutorPilotCheckIns.filter((row) => row.cohortId === cohort.id);
  const incidents = state.privateTutorPilotIncidents.filter((row) => row.cohortId === cohort.id);
  const sessionDays = new Map();
  for (const session of sessions) {
    const days = sessionDays.get(session.learnerId) ?? new Set();
    days.add(String(session.completedAt).slice(0, 10));
    sessionDays.set(session.learnerId, days);
  }
  const independent = attempts.filter((row) => row.correct && row.independent && !row.usedHint).length;
  const hinted = attempts.filter((row) => row.usedHint).length;
  return {
    cohortId: cohort.id, status: cohort.status, participantTarget: cohort.participantTarget,
    enrollment: {
      consented: participations.length,
      active: participations.filter((row) => row.status === "active").length,
      withdrawn: participations.filter((row) => row.status === "withdrawn").length,
      capacityRemaining: Math.max(0, cohort.participantTarget - new Set(participations.map((row) => row.learnerId)).size),
    },
    engagement: {
      learnersWithCompletedSessions: sessionDays.size,
      returningLearners: [...sessionDays.values()].filter((days) => days.size >= 2).length,
      completedSessions: sessions.length,
      learningMinutes: sessions.reduce((sum, row) => sum + Number(row.plannedMinutes ?? 0), 0),
      evidenceCount: attempts.length,
      independentCorrectRate: attempts.length ? round(independent / attempts.length) : null,
      hintDependenceRate: attempts.length ? round(hinted / attempts.length) : null,
    },
    experience: {
      checkInCount: checkIns.length,
      guardianPressure: distribution(checkIns, "guardianPressure", [...PRESSURE_LEVELS]),
      childWillingToReturn: distribution(checkIns, "childWillingToReturn", [...WILLINGNESS_LEVELS]),
    },
    safety: {
      total: incidents.length,
      open: incidents.filter((row) => row.status !== "resolved").length,
      escalated: incidents.filter((row) => row.status === "escalated").length,
      critical: incidents.filter((row) => row.severity === "critical").length,
    },
    privacy: { learnerIdsExposed: false, rawAnswersExposed: false, incidentFreeTextExposed: false },
    generatedAt: at,
  };
}

function currentCohort(state) {
  return state.privateTutorPilotCohorts.find((row) => ["active", "paused"].includes(row.status)) ?? null;
}

function consentDocumentForCohort(cohort) {
  return CONSENT_DOCUMENTS.find((document) => document.id === cohort.consentDocumentId && document.checksum === cohort.consentDocumentChecksum) ?? null;
}

function activeParticipation(state, learnerId) {
  return state.privateTutorPilotParticipations.find((row) => row.learnerId === learnerId && row.status === "active") ?? null;
}

function cohortView(cohort) {
  const { enrolledLearnerIds: _learnerIds, ...view } = cohort;
  return clone(view);
}

function normalizeAcknowledgements(value) {
  if (!value || ACKNOWLEDGEMENT_KEYS.some((key) => value[key] !== true)) return null;
  return Object.fromEntries(ACKNOWLEDGEMENT_KEYS.map((key) => [key, true]));
}

function pauseCohort(cohort, { actorId, reason, at }) {
  Object.assign(cohort, { status: "paused", pausedAt: at, pausedBy: actorId, pauseReason: reason });
}

function guardianIncidentSeverity(category, needsImmediateStop) {
  if (needsImmediateStop) return "critical";
  if (["child_distress", "privacy"].includes(category)) return "high";
  return "moderate";
}

function distribution(rows, key, values) {
  return Object.fromEntries(values.map((value) => [value, rows.filter((row) => row[key] === value).length]));
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function failure(status, error) {
  return { ok: false, status, error };
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}
