import { createHash } from "node:crypto";
import { activePrivateTutorQuestionRevision } from "./private-tutor-content.mjs";
import { currentPrivateTutorPilotConsentDocument } from "./private-tutor-pilot.mjs";

export const PRIVATE_TUTOR_RELEASE_GATES = [
  gate("math_content", "数学内容双人审核", true, 365, [
    target("content-review", "正式题目与答案审查", "manual_review", environment("not_applicable", "not_applicable", "not_applicable", "not_applicable")),
  ]),
  gate("voice_confidence", "低置信度语音不会直接判题", false, 90, [
    target("desktop-stable", "桌面端稳定网络", "device_test", environment("desktop", "windows", "chromium", "stable")),
    target("tablet-constrained", "平板端受限网络", "device_test", environment("tablet", "android", "chromium", "constrained")),
  ]),
  gate("visual_math", "视觉场景数学参数校验", false, 90, [
    target("desktop-chromium", "桌面端 Chromium", "device_test", environment("desktop", "windows", "chromium", "stable")),
    target("tablet-chromium", "平板端 Chromium", "device_test", environment("tablet", "android", "chromium", "stable")),
  ]),
  gate("learner_isolation", "跨孩子数据隔离", false, 90, [
    target("server-automated", "服务端隔离自动化测试", "automated_test", environment("server", "linux", "not_applicable", "stable")),
  ]),
  gate("child_safety", "儿童安全评审", false, 90, [
    target("safety-review", "儿童安全人工评审", "manual_review", environment("not_applicable", "not_applicable", "not_applicable", "not_applicable")),
  ]),
  gate("data_deletion_drill", "数据删除演练", false, 90, [
    target("server-drill", "生产等价删除演练", "incident_drill", environment("server", "linux", "not_applicable", "stable")),
  ]),
  gate("family_usability", "家庭低压力可用性评审", false, 90, [
    target("desktop-family", "桌面端家庭体验", "manual_review", environment("desktop", "windows", "chromium", "stable")),
    target("tablet-family", "平板端家庭体验", "manual_review", environment("tablet", "android", "chromium", "stable")),
  ]),
  gate("pilot_owner", "试点退出与异常响应负责人", false, 30, [
    target("operations-drill", "退出与异常响应演练", "operations_drill", environment("not_applicable", "not_applicable", "not_applicable", "not_applicable")),
  ]),
];

const RELEASE_EVIDENCE_CONTRACT_VERSION = 2;
const SHA256 = /^[a-f0-9]{64}$/;

export function privateTutorGuardianPreferences(state, learner, guardianUserId) {
  return state.privateTutorGuardianPreferences.find((row) =>
    row.learnerId === learner.id && row.guardianUserId === guardianUserId) ?? {
    learnerId: learner.id,
    guardianUserId,
    notificationFrequency: "weekly",
    quietHours: { enabled: true, start: "20:00", end: "07:00" },
    weeklyProgressSummary: true,
    dailyErrorAlerts: false,
    updatedAt: null,
  };
}

export function updatePrivateTutorGuardianPreferences(state, learner, guardianUserId, input, { at, nextId }) {
  const notificationFrequency = String(input?.notificationFrequency ?? "weekly");
  const quietHours = input?.quietHours ?? {};
  const start = String(quietHours.start ?? "20:00");
  const end = String(quietHours.end ?? "07:00");
  if (!["off", "weekly"].includes(notificationFrequency) || !time(start) || !time(end) || input?.dailyErrorAlerts === true) {
    return { ok: false, error: "invalid_private_tutor_guardian_preferences" };
  }
  let preferences = state.privateTutorGuardianPreferences.find((row) =>
    row.learnerId === learner.id && row.guardianUserId === guardianUserId);
  if (!preferences) {
    preferences = {
      id: nextId("ptgp"),
      ownerTeamId: learner.ownerTeamId,
      learnerId: learner.id,
      guardianUserId,
      createdAt: at,
    };
    state.privateTutorGuardianPreferences.unshift(preferences);
  }
  Object.assign(preferences, {
    notificationFrequency,
    quietHours: { enabled: quietHours.enabled !== false, start, end },
    weeklyProgressSummary: input?.weeklyProgressSummary !== false,
    dailyErrorAlerts: false,
    updatedAt: at,
  });
  return { ok: true, preferences };
}

export function buildPrivateTutorWeeklyReport({ learner, snapshot, attempts, themes, sessions, now }) {
  const generatedAt = now();
  const since = Date.parse(generatedAt) - 7 * 86_400_000;
  const weeklyAttempts = attempts.filter((row) => row.learnerId === learner.id && Date.parse(row.createdAt) >= since);
  const weeklySessions = sessions.filter((row) => row.learnerId === learner.id && row.status === "completed" && Date.parse(row.completedAt) >= since);
  const independentCorrect = weeklyAttempts.filter((row) => row.correct && row.independent && !row.usedHint).length;
  const activeThemes = themes.filter((row) => row.learnerId === learner.id && row.status !== "mastered");
  const masteredThemes = themes.filter((row) => row.learnerId === learner.id && row.status === "mastered" && Date.parse(row.masteredAt) >= since);
  const strongest = [...(snapshot?.knowledge ?? [])]
    .filter((row) => row.mastery != null)
    .sort((left, right) => right.mastery - left.mastery)[0] ?? null;
  return {
    learnerId: learner.id,
    learnerName: learner.displayName,
    period: { days: 7, from: new Date(since).toISOString(), to: generatedAt },
    progress: {
      completedSessions: weeklySessions.length,
      learningMinutes: weeklySessions.reduce((sum, row) => sum + Number(row.plannedMinutes ?? 0), 0),
      evidenceCount: weeklyAttempts.length,
      independentCorrect,
      masteredThemeCount: masteredThemes.length,
    },
    highlight: independentCorrect
      ? `${learner.displayName}这一周有 ${independentCorrect} 次是在没有提示时独立完成的。`
      : `${learner.displayName}正在建立新的学习证据，本周不需要追赶。`,
    evidence: strongest ? `目前最稳定的是“${knowledgeTitle(strongest.id)}”，掌握证据约 ${Math.round(strongest.mastery * 100)}%。` : "当前证据还不够，先让孩子按自己的节奏完成摸底。",
    nextStep: activeThemes[0]
      ? `下一步会轻量复习“${activeThemes[0].title}”，不需要额外加题。`
      : "下一步继续按每日计划学习，不需要额外布置练习。",
    familySuggestion: "可以问一句“今天哪个瞬间让你觉得自己会了？”，不用追问分数或错题数量。",
    pressureSafety: {
      rankingShown: false,
      dailyErrorAlertEnabled: false,
      comparisonWithOthers: false,
    },
    generatedAt,
  };
}

export function recordPrivateTutorReleaseEvaluation(state, {
  gateId, targetId, status, evidence, evidenceType, environment: actualEnvironment,
  artifactName, artifactChecksumSha256, executedAt, reviewerId, at, nextId,
  buildId = "development-unversioned",
}) {
  const definition = PRIVATE_TUTOR_RELEASE_GATES.find((row) => row.id === gateId);
  const evidenceTarget = definition?.targets.find((row) => row.id === targetId);
  const recordedAt = validIso(at);
  const executionTime = validIso(executedAt);
  const normalizedChecksum = String(artifactChecksumSha256 ?? "").trim().toLowerCase();
  const normalizedArtifactName = String(artifactName ?? "").trim();
  if (!definition || !evidenceTarget
    || !["passed", "failed"].includes(status)
    || !String(evidence ?? "").trim()
    || !String(reviewerId ?? "").trim()
    || evidenceType !== evidenceTarget.evidenceType
    || !sameEnvironment(actualEnvironment, evidenceTarget.environment)
    || !recordedAt || !executionTime
    || Date.parse(executionTime) > Date.parse(recordedAt) + 5 * 60_000
    || !normalizedArtifactName || normalizedArtifactName.length > 120 || /[\\/]/.test(normalizedArtifactName)
    || !SHA256.test(normalizedChecksum)) return null;
  const expiresAt = new Date(Date.parse(executionTime) + definition.evidenceValidityDays * 86_400_000).toISOString();
  const evaluation = {
    id: nextId("ptge"),
    contractVersion: RELEASE_EVIDENCE_CONTRACT_VERSION,
    gateId,
    targetId,
    status,
    evidence: String(evidence).trim().slice(0, 500),
    evidenceType,
    environment: { ...evidenceTarget.environment },
    artifact: { name: normalizedArtifactName, checksumSha256: normalizedChecksum },
    executedAt: executionTime,
    expiresAt,
    reviewerId,
    buildId,
    scopeChecksum: privateTutorReleaseScopeChecksum(state, buildId),
    evaluatedAt: recordedAt,
  };
  state.privateTutorReleaseEvaluations.unshift(evaluation);
  return evaluation;
}

export function privateTutorReleaseReadiness(state, buildId = "development-unversioned", at = new Date().toISOString()) {
  const scopeChecksum = privateTutorReleaseScopeChecksum(state, buildId);
  const evaluatedAt = validIso(at) ?? new Date().toISOString();
  const gates = PRIVATE_TUTOR_RELEASE_GATES.map((definition) => {
    const evaluations = state.privateTutorReleaseEvaluations
      .filter((row) => row.contractVersion === RELEASE_EVIDENCE_CONTRACT_VERSION
        && row.gateId === definition.id && row.scopeChecksum === scopeChecksum)
      .sort((left, right) => String(right.evaluatedAt).localeCompare(String(left.evaluatedAt)));
    const requiredReviewers = definition.doubleReview ? 2 : 1;
    const targets = definition.targets.map((evidenceTarget) => {
      const latestByReviewer = new Map();
      for (const evaluation of evaluations.filter((row) => row.targetId === evidenceTarget.id)) {
        if (!latestByReviewer.has(evaluation.reviewerId)) latestByReviewer.set(evaluation.reviewerId, evaluation);
      }
      const current = [...latestByReviewer.values()];
      const valid = current.filter((row) => Date.parse(row.expiresAt) > Date.parse(evaluatedAt));
      const failed = valid.some((row) => row.status === "failed");
      const passed = valid.filter((row) => row.status === "passed");
      const expiredEvidenceCount = current.length - valid.length;
      const status = failed ? "failed"
        : passed.length >= requiredReviewers ? "passed"
          : current.length > 0 && valid.length === 0 ? "expired" : "not_evaluated";
      return {
        ...evidenceTarget,
        status,
        requiredReviewers,
        passedReviewers: passed.length,
        expiredEvidenceCount,
        latestEvidence: current[0]?.evidence ?? null,
        latestArtifact: current[0]?.artifact ?? null,
        executedAt: current[0]?.executedAt ?? null,
        expiresAt: current[0]?.expiresAt ?? null,
        evaluatedAt: current[0]?.evaluatedAt ?? null,
      };
    });
    const status = targets.some((row) => row.status === "failed") ? "failed"
      : targets.every((row) => row.status === "passed") ? "passed"
        : targets.some((row) => row.status === "expired") ? "expired"
          : targets.some((row) => row.passedReviewers > 0) ? "incomplete" : "not_evaluated";
    const latest = evaluations[0] ?? null;
    return {
      ...definition,
      status,
      targets,
      completedTargets: targets.filter((row) => row.status === "passed").length,
      missingTargetIds: targets.filter((row) => row.status !== "passed").map((row) => row.id),
      expiredEvidenceCount: targets.reduce((sum, row) => sum + row.expiredEvidenceCount, 0),
      passedReviewers: Math.min(...targets.map((row) => row.passedReviewers)),
      latestEvidence: latest?.evidence ?? null,
      evaluatedAt: latest?.evaluatedAt ?? null,
    };
  });
  const ready = gates.every((row) => row.status === "passed");
  return {
    status: ready ? "ready_for_controlled_pilot" : "blocked",
    ready,
    gates,
    buildId,
    scopeChecksum,
    evaluatedAt,
    evidenceContractVersion: RELEASE_EVIDENCE_CONTRACT_VERSION,
    rule: "当前构建的所有门禁、目标设备矩阵和未过期证据均通过后，才允许创建 30–100 名学生、7 天的受控试点。",
  };
}

export function enforcePrivateTutorReleaseGates(state, readiness, at) {
  if (readiness.ready) return { paused: 0 };
  const blockedGateIds = readiness.gates.filter((gate) => gate.status !== "passed").map((gate) => gate.id);
  let paused = 0;
  for (const cohort of state.privateTutorPilotCohorts) {
    if (cohort.status !== "active") continue;
    Object.assign(cohort, {
      status: "paused",
      pausedAt: at,
      pausedBy: "system",
      pauseReason: `release_gates_blocked:${blockedGateIds.join(",")}`.slice(0, 500),
    });
    paused += 1;
  }
  return { paused };
}

export function createPrivateTutorPilotCohort(state, input, { actor, now, nextId, buildId = "development-unversioned" }) {
  const startedAt = now();
  const readiness = privateTutorReleaseReadiness(state, buildId, startedAt);
  if (!readiness.ready) return { ok: false, status: 409, error: "private_tutor_release_gates_blocked", readiness };
  const participantTarget = Number(input?.participantTarget);
  const responseOwner = String(input?.responseOwner ?? "").trim();
  if (!Number.isInteger(participantTarget) || participantTarget < 30 || participantTarget > 100 || !responseOwner) {
    return { ok: false, status: 400, error: "invalid_private_tutor_pilot_cohort" };
  }
  if (state.privateTutorPilotCohorts.some((row) => ["active", "paused"].includes(row.status))) {
    return { ok: false, status: 409, error: "private_tutor_pilot_already_active" };
  }
  const consentDocument = currentPrivateTutorPilotConsentDocument();
  const cohort = {
    id: nextId("ptpc"),
    status: "active",
    participantTarget,
    durationDays: 7,
    responseOwner: responseOwner.slice(0, 120),
    consentDocumentId: consentDocument.id,
    consentDocumentVersion: consentDocument.version,
    consentDocumentChecksum: consentDocument.checksum,
    exitPolicy: "guardian_can_withdraw_and_request_deletion",
    releaseBuildId: buildId,
    releaseScopeChecksum: readiness.scopeChecksum,
    createdBy: actor.userId,
    startedAt,
    endsAt: new Date(Date.parse(startedAt) + 7 * 86_400_000).toISOString(),
    enrolledLearnerIds: [],
    pausedAt: null,
    pausedBy: null,
    pauseReason: null,
  };
  state.privateTutorPilotCohorts.unshift(cohort);
  return { ok: true, cohort };
}

function gate(id, label, doubleReview, evidenceValidityDays, targets) {
  return { id, label, required: true, doubleReview, evidenceValidityDays, targets };
}

function target(id, label, evidenceType, requiredEnvironment) {
  return { id, label, evidenceType, environment: requiredEnvironment };
}

function environment(deviceClass, operatingSystem, browserEngine, networkProfile) {
  return { deviceClass, operatingSystem, browserEngine, networkProfile };
}

function sameEnvironment(actual, required) {
  return actual && ["deviceClass", "operatingSystem", "browserEngine", "networkProfile"]
    .every((key) => actual[key] === required[key]);
}

function validIso(value) {
  const milliseconds = Date.parse(String(value ?? ""));
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function privateTutorReleaseScopeChecksum(state, buildId) {
  const questionIds = [...new Set((state.privateTutorQuestionRevisions ?? []).map((row) => row.questionId))];
  const activeContent = questionIds
    .map((questionId) => (Array.isArray(state.privateTutorContentEvents) ? activePrivateTutorQuestionRevision(state, questionId) : null)
      ?? (state.privateTutorQuestionRevisions ?? []).find((row) => row.questionId === questionId && row.active === true && row.status === "published"))
    .filter(Boolean)
    .map((row) => ({ id: row.id, questionId: row.questionId, version: row.version, checksum: row.contentChecksum }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const consent = currentPrivateTutorPilotConsentDocument();
  return createHash("sha256").update(JSON.stringify({ contractVersion: 1, buildId, activeContent, consent: { id: consent.id, version: consent.version, checksum: consent.checksum } })).digest("hex");
}

function time(value) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function knowledgeTitle(id) {
  return {
    integer: "有理数运算",
    "equation-meaning": "等式与方程",
    balance: "等式两边同乘同除",
    "word-problem": "一元一次方程应用",
  }[id] ?? id;
}
