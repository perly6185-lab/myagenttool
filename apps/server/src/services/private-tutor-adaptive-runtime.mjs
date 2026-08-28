import { createHash } from "node:crypto";
import { buildPrivateTutorSevenDayPlan } from "./private-tutor-learning-model.mjs";
import { privateTutorLearningPreferences } from "./private-tutor-learning-preferences.mjs";
import { privateTutorPackageRegistryFromState } from "./private-tutor-package-registry.mjs";
import { parseRationalAnswer } from "./plugins/math-plugin.mjs";

export const PRIVATE_TUTOR_RUNTIME_VALIDATION_SCHEMA_VERSION = 1;
export const PRIVATE_TUTOR_RUNTIME_EVIDENCE_POLICY = "runtime_validated_capped";
export const PRIVATE_TUTOR_RUNTIME_EVIDENCE_CONFIDENCE_CAP = 0.85;

const AUTHORED_CONTEXT_FIELDS = [
  ["diagnosticQuestions", "diagnostic"],
  ["tutoringQuestions", "tutoring"],
  ["dailyQuestions", "practice"],
  ["reviewQuestions", "review"],
];

export function validatePrivateTutorPackageRuntime(state, packageId, {
  actorId,
  learnerId = null,
  now = new Date().toISOString(),
  nextId = (prefix) => `${prefix}_${Date.now()}`,
} = {}) {
  ensureRuntimeCollections(state);
  const registry = privateTutorPackageRegistryFromState(state);
  const pkg = registry.getPackage(packageId);
  if (!pkg || (pkg.status != null && pkg.status !== "published")) throw new Error("private_tutor_content_package_not_available");
  if (pkg.sourceType !== "user_material") return null;
  if (!actorId || pkg.learningProfileId !== actorId) throw new Error("private_tutor_content_package_not_found");

  const material = state.privateTutorMaterialDocuments.find((item) =>
    item.id === pkg.source?.materialDocumentId
    && item.learningProfileId === actorId
    && item.sourceHash === pkg.source?.sourceHash
    && item.status === "parsed");
  const plugin = registry.getSubjectPlugin(pkg.evaluationSubjectId ?? pkg.subjectId);
  const pluginCapabilities = plugin?.getCapabilities?.() ?? {};
  const questions = authoredQuestions(pkg);
  const failureCodes = [];
  if (!material) failureCodes.push("source_material_unavailable");
  if (!plugin || (pluginCapabilities.semanticEvaluation !== "anchored-concept-rubric-v2"
    && pluginCapabilities.deterministicGrading !== true)) {
    failureCodes.push("runtime_evaluator_unavailable");
  }
  if (!questions.length) failureCodes.push("runtime_questions_unavailable");

  const questionResults = questions.map(({ question, context }) => calibrateQuestion(question, context, plugin));
  if (questionResults.some((item) => item.status !== "passed")) failureCodes.push("runtime_anchor_calibration_failed");
  const status = failureCodes.length ? "blocked" : "passed";
  const existing = latestRuntimeValidation(state, pkg.id, pkg.version);
  if (existing?.status === "passed"
    && existing.contentChecksum === pkg.contentChecksum
    && existing.sourceHash === pkg.source?.sourceHash
    && JSON.stringify(existing.questions) === JSON.stringify(questionResults)) {
    existing.learnerId ??= learnerId;
    return existing;
  }

  if (existing?.status === "passed") {
    existing.status = "superseded";
    existing.revokedAt = now;
    existing.revokeReason = "runtime_revalidated";
  }
  const validation = {
    id: nextId("ptrv"),
    schemaVersion: PRIVATE_TUTOR_RUNTIME_VALIDATION_SCHEMA_VERSION,
    packageId: pkg.id,
    packageVersion: pkg.version,
    contentChecksum: pkg.contentChecksum ?? null,
    sourceMaterialId: pkg.source?.materialDocumentId ?? null,
    sourceHash: pkg.source?.sourceHash ?? null,
    evaluatorSubjectId: pkg.evaluationSubjectId ?? pkg.subjectId,
    evaluatorVersion: plugin?.version ?? null,
    status,
    failureCodes: [...new Set(failureCodes)],
    questions: questionResults,
    validatedBy: actorId,
    learnerId,
    validatedAt: now,
    revokedAt: null,
    revokeReason: null,
  };
  state.privateTutorRuntimeValidations.unshift(validation);
  return validation;
}

export function privateTutorRuntimeValidation(state, packageId, packageVersion = null) {
  ensureRuntimeCollections(state);
  const pkg = privateTutorPackageRegistryFromState(state).getPackage(packageId);
  if (!pkg || (pkg.status != null && pkg.status !== "published")) return null;
  const validation = latestRuntimeValidation(state, packageId, packageVersion ?? pkg.version);
  if (!validation
    || validation.status !== "passed"
    || validation.contentChecksum !== (pkg.contentChecksum ?? null)
    || validation.sourceHash !== (pkg.source?.sourceHash ?? null)) return null;
  const material = state.privateTutorMaterialDocuments.find((item) =>
    item.id === validation.sourceMaterialId
    && item.sourceHash === validation.sourceHash
    && item.status === "parsed");
  return material ? validation : null;
}

export function applyPrivateTutorRuntimeEvidencePolicy(state, pkg, question) {
  if (!question || question.evidencePolicy !== "practice_only_until_runtime_validation") return question;
  const validation = privateTutorRuntimeValidation(state, pkg.id, pkg.version);
  const fingerprint = privateTutorRuntimeQuestionFingerprint(question);
  const calibrated = validation?.questions.find((item) =>
    item.questionRevisionId === question.id
    && item.questionFingerprint === fingerprint
    && item.status === "passed");
  if (!calibrated) return question;
  return {
    ...question,
    evidencePolicy: PRIVATE_TUTOR_RUNTIME_EVIDENCE_POLICY,
    runtimeValidation: {
      id: validation.id,
      schemaVersion: validation.schemaVersion,
      questionFingerprint: fingerprint,
      evaluatorVersion: validation.evaluatorVersion,
      confidenceCap: PRIVATE_TUTOR_RUNTIME_EVIDENCE_CONFIDENCE_CAP,
      validatedAt: validation.validatedAt,
    },
  };
}

export function activatePrivateTutorPackageRuntime(state, {
  learner,
  pkg,
  actorId,
  entryMode,
  startModuleId = null,
  startTopicId = null,
  startKnowledgeId = null,
  now,
  nextId,
}) {
  ensureRuntimeCollections(state);
  if (!learner || !pkg || !["diagnostic", "chapter"].includes(entryMode)) {
    throw new Error("invalid_private_tutor_package_activation");
  }
  let validation = null;
  if (pkg.sourceType === "user_material") {
    validation = validatePrivateTutorPackageRuntime(state, pkg.id, { actorId, learnerId: learner.id, now: now(), nextId });
    if (validation?.status !== "passed") throw new Error("private_tutor_runtime_validation_failed");
  }
  const selection = entryMode === "chapter"
    ? resolveChapterSelection(pkg, { startModuleId, startTopicId, startKnowledgeId })
    : { moduleId: null, topicId: null, knowledgeId: null, scopeKnowledgeIds: [] };
  for (const activation of state.privateTutorPackageActivations) {
    if (activation.learnerId === learner.id && activation.status === "active") {
      activation.status = "inactive";
      activation.deactivatedAt = now();
    }
  }
  const activatedAt = now();
  const activation = {
    id: nextId("ptact"),
    ownerTeamId: learner.ownerTeamId,
    learnerId: learner.id,
    actorId,
    packageId: pkg.id,
    packageVersion: pkg.version,
    contentChecksum: pkg.contentChecksum ?? null,
    entryMode,
    startModuleId: selection.moduleId,
    startTopicId: selection.topicId,
    startKnowledgeId: selection.knowledgeId,
    scopeKnowledgeIds: selection.scopeKnowledgeIds,
    runtimeValidationId: validation?.id ?? null,
    status: "active",
    activatedAt,
    deactivatedAt: null,
  };
  supersedePreviousLearningRuntime(state, learner.id, pkg.id, activatedAt);
  state.privateTutorPackageActivations.unshift(activation);
  const intelligence = entryMode === "chapter"
    ? createChapterEntryIntelligence(state, { learner, pkg, selection, activationId: activation.id, activatedAt, now, nextId })
    : { learnerModel: null, strategyDecision: null, learningPlan: null };
  return { activation, runtimeValidation: validation, ...intelligence };
}

export function deactivateMaterialDerivedLearning(state, material, at) {
  ensureRuntimeCollections(state);
  const packageIds = new Set(state.privateTutorContentPackages
    .filter((pkg) => pkg.sourceType === "user_material" && pkg.source?.materialDocumentId === material.id)
    .map((pkg) => pkg.id));
  for (const pkg of state.privateTutorContentPackages) {
    if (!packageIds.has(pkg.id)) continue;
    pkg.status = "source_removed";
    pkg.sourceUnavailableAt = at;
    pkg.updatedAt = at;
  }
  for (const validation of state.privateTutorRuntimeValidations) {
    if (!packageIds.has(validation.packageId) || validation.status === "revoked") continue;
    validation.status = "revoked";
    validation.revokedAt = at;
    validation.revokeReason = "source_material_deleted";
  }
  for (const activation of state.privateTutorPackageActivations) {
    if (!packageIds.has(activation.packageId) || activation.status !== "active") continue;
    activation.status = "source_unavailable";
    activation.deactivatedAt = at;
  }
  for (const plan of state.privateTutorLearningPlans ?? []) {
    if (packageIds.has(plan.contentPackageId) && plan.status === "active") {
      plan.status = "source_unavailable";
      plan.updatedAt = at;
    }
  }
  for (const session of state.privateTutorSessions ?? []) {
    if (packageIds.has(session.contentPackageId) && ["active", "paused"].includes(session.status)) {
      session.status = "source_unavailable";
      session.updatedAt = at;
      session.revision += 1;
    }
  }
  return { packageIds: [...packageIds], deactivatedPackageCount: packageIds.size };
}

export function isPrivateTutorPackageLearningAvailable(state, packageId) {
  const pkg = privateTutorPackageRegistryFromState(state).getPackage(packageId);
  if (!pkg || (pkg.status != null && pkg.status !== "published")) return false;
  if (pkg.sourceType !== "user_material") return true;
  return Boolean(privateTutorRuntimeValidation(state, pkg.id, pkg.version));
}

export function privateTutorRuntimeQuestionFingerprint(question) {
  return createHash("sha256").update(JSON.stringify({
    id: question?.id,
    questionId: question?.questionId,
    knowledgeId: question?.knowledgeId,
    context: question?.context,
    difficulty: question?.difficulty,
    kind: question?.kind,
    prompt: question?.prompt,
    referenceAnswer: question?.referenceAnswer,
    requiredSourceRefs: question?.requiredSourceRefs,
    sourceRefs: question?.sourceRefs,
    rubric: question?.rubric,
    expectedAnswer: question?.expectedAnswer,
    expectedChoice: question?.expectedChoice,
    options: question?.options,
    mathContract: question?.mathContract,
    expectedSteps: question?.expectedSteps,
    evidencePolicy: question?.evidencePolicy,
  })).digest("hex");
}

function calibrateQuestion(question, context, plugin) {
  const result = {
    questionRevisionId: question?.id ?? null,
    questionFingerprint: privateTutorRuntimeQuestionFingerprint({ ...question, context }),
    context,
    status: "blocked",
    failureCodes: [],
    anchors: [],
  };
  if (["numeric", "choice", "math_steps"].includes(question?.kind)) {
    return calibrateDeterministicQuestion(result, question, plugin);
  }
  if (!plugin || question?.kind !== "rubric_response"
    || question?.rubric?.profile !== "anchored-concept-rubric-v2"
    || question?.evidencePolicy !== "practice_only_until_runtime_validation") {
    result.failureCodes.push("unsupported_runtime_question");
    return result;
  }
  for (const band of ["insufficient", "developing", "proficient"]) {
    const anchor = question.rubric.anchors?.find((item) => item.band === band);
    if (!anchor?.sample) {
      result.failureCodes.push(`missing_${band}_anchor`);
      continue;
    }
    try {
      const first = plugin.evaluator({ rawAnswer: anchor.sample, responseKind: "answer", source: "runtime_calibration" }, { ...question, context });
      const second = plugin.evaluator({ rawAnswer: anchor.sample, responseKind: "answer", source: "runtime_calibration" }, { ...question, context });
      const observedBand = first?.evaluation?.scoreBand ?? null;
      const repeatable = JSON.stringify(first) === JSON.stringify(second);
      const expectedCorrect = band === "proficient";
      const passed = first?.accepted === true
        && first.correct === expectedCorrect
        && observedBand === band
        && repeatable
        && first.evaluation?.unknownSourceRefs?.length === 0
        && (band !== "proficient" || first.evaluation?.requiresReview !== true);
      result.anchors.push({
        anchorId: anchor.id,
        expectedBand: band,
        observedBand,
        correct: first?.correct ?? null,
        repeatable,
        passed,
      });
      if (!passed) result.failureCodes.push(`${band}_anchor_mismatch`);
    } catch {
      result.failureCodes.push(`${band}_anchor_evaluation_failed`);
    }
  }
  result.failureCodes = [...new Set(result.failureCodes)];
  result.status = result.failureCodes.length ? "blocked" : "passed";
  return result;
}

function calibrateDeterministicQuestion(result, question, plugin) {
  const prepared = question.kind === "numeric"
    ? { ...question, expectedRational: parseRationalAnswer(question.expectedAnswer) }
    : question;
  let correctSample = null;
  let incorrectSample = null;
  if (question.kind === "numeric" && prepared.expectedRational) {
    correctSample = question.expectedAnswer;
    incorrectSample = `(${question.expectedAnswer})+1`;
  } else if (question.kind === "choice") {
    correctSample = question.expectedChoice;
    incorrectSample = question.options?.find((option) => option.id !== question.expectedChoice)?.id ?? null;
  } else if (question.kind === "math_steps") {
    correctSample = question.expectedSteps?.map((step) => step.acceptedForms?.[0]).filter(Boolean).join("\n") || null;
    incorrectSample = "0=1";
  }
  if (!plugin || !correctSample || !incorrectSample) {
    result.failureCodes.push("invalid_deterministic_contract");
    return result;
  }
  try {
    const firstCorrect = plugin.evaluator({ rawAnswer: correctSample, responseKind: "answer", source: "runtime_calibration" }, prepared);
    const secondCorrect = plugin.evaluator({ rawAnswer: correctSample, responseKind: "answer", source: "runtime_calibration" }, prepared);
    const firstIncorrect = plugin.evaluator({ rawAnswer: incorrectSample, responseKind: "answer", source: "runtime_calibration" }, prepared);
    const secondIncorrect = plugin.evaluator({ rawAnswer: incorrectSample, responseKind: "answer", source: "runtime_calibration" }, prepared);
    const correctPassed = firstCorrect?.accepted === true && firstCorrect.correct === true
      && JSON.stringify(firstCorrect) === JSON.stringify(secondCorrect);
    const incorrectPassed = firstIncorrect?.accepted === true && firstIncorrect.correct === false
      && JSON.stringify(firstIncorrect) === JSON.stringify(secondIncorrect);
    result.anchors.push(
      { anchorId: "deterministic_correct", expectedCorrect: true, correct: firstCorrect?.correct ?? null, repeatable: JSON.stringify(firstCorrect) === JSON.stringify(secondCorrect), passed: correctPassed },
      { anchorId: "deterministic_incorrect", expectedCorrect: false, correct: firstIncorrect?.correct ?? null, repeatable: JSON.stringify(firstIncorrect) === JSON.stringify(secondIncorrect), passed: incorrectPassed },
    );
    if (!correctPassed) result.failureCodes.push("correct_anchor_mismatch");
    if (!incorrectPassed) result.failureCodes.push("incorrect_anchor_mismatch");
  } catch {
    result.failureCodes.push("deterministic_anchor_evaluation_failed");
  }
  result.failureCodes = [...new Set(result.failureCodes)];
  result.status = result.failureCodes.length ? "blocked" : "passed";
  return result;
}

function authoredQuestions(pkg) {
  return (pkg.knowledgeComponents ?? []).flatMap((knowledge) => AUTHORED_CONTEXT_FIELDS.flatMap(([field, context]) =>
    (knowledge[field] ?? []).map((question) => ({ question: { ...question, context }, context }))));
}

function latestRuntimeValidation(state, packageId, packageVersion) {
  return state.privateTutorRuntimeValidations.find((item) =>
    item.packageId === packageId && item.packageVersion === packageVersion) ?? null;
}

function resolveChapterSelection(pkg, input) {
  const modules = pkg.modules ?? [];
  const knowledgeById = new Map((pkg.knowledgeComponents ?? []).map((item) => [item.id, item]));
  let module = input.startModuleId ? modules.find((item) => item.id === input.startModuleId) : null;
  let topic = input.startTopicId
    ? modules.flatMap((item) => item.topics ?? []).find((item) => item.id === input.startTopicId)
    : null;
  let knowledge = input.startKnowledgeId ? knowledgeById.get(input.startKnowledgeId) : null;
  if (input.startKnowledgeId && !knowledge) throw new Error("private_tutor_start_knowledge_not_found");
  if (input.startTopicId && !topic) throw new Error("private_tutor_start_topic_not_found");
  if (input.startModuleId && !module) throw new Error("private_tutor_start_module_not_found");
  if (knowledge && !topic) topic = modules.flatMap((item) => item.topics ?? []).find((item) => item.id === knowledge.topicId) ?? null;
  if (topic && !module) module = modules.find((item) => (item.topics ?? []).some((item) => item.id === topic.id)) ?? null;
  module ??= modules[0] ?? null;
  topic ??= module?.topics?.[0] ?? null;
  const scopeKnowledgeIds = knowledge
    ? [knowledge.id]
    : (topic?.knowledgeComponentIds ?? []).filter((id) => knowledgeById.has(id));
  knowledge ??= knowledgeById.get(scopeKnowledgeIds[0]) ?? null;
  if (!module || !topic || !knowledge || !scopeKnowledgeIds.length) throw new Error("private_tutor_chapter_content_unavailable");
  return { moduleId: module.id, topicId: topic.id, knowledgeId: knowledge.id, scopeKnowledgeIds };
}

function createChapterEntryIntelligence(state, { learner, pkg, selection, activationId, activatedAt, now, nextId }) {
  const previousModel = state.privateTutorLearnerModels.find((row) => row.learnerId === learner.id && row.contentPackageId === pkg.id);
  const snapshot = state.privateTutorSnapshots.find((row) => row.learnerId === learner.id);
  const definitions = pkg.knowledgeComponents ?? [];
  const knowledge = definitions.map((definition) => ({
    id: definition.id,
    title: definition.name ?? definition.id,
    mastery: snapshot?.knowledge.find((item) => item.id === definition.id)?.mastery ?? null,
    level: snapshot?.knowledge.find((item) => item.id === definition.id)?.level ?? "unknown",
    confidence: 0,
    evidenceCount: snapshot?.knowledge.find((item) => item.id === definition.id)?.evidenceCount ?? 0,
    independentCorrect: 0,
    hintedCorrect: 0,
    incorrect: 0,
    hintDependency: 0,
    latestEvidenceAt: null,
    forgettingRisk: 0,
    misconception: null,
    prerequisiteId: definition.prerequisiteKnowledgeIds?.[0] ?? null,
    prerequisiteGap: false,
    downstreamImpact: Number(definition.downstreamImpact ?? 1),
    recentAttemptIds: [],
  }));
  const learnerModel = {
    id: nextId("ptm"),
    ownerTeamId: learner.ownerTeamId,
    learnerId: learner.id,
    contentPackageId: pkg.id,
    contentPackageVersion: pkg.version,
    subjectId: pkg.subjectId,
    revision: (previousModel?.revision ?? 0) + 1,
    sourceSnapshotRevision: snapshot?.revision ?? 0,
    reason: "user_selected_chapter",
    activationId,
    activationStatus: "active",
    knowledge,
    createdAt: activatedAt,
    updatedAt: activatedAt,
  };
  state.privateTutorLearnerModels.unshift(learnerModel);
  const target = knowledge.find((item) => item.id === selection.knowledgeId);
  const strategyDecision = {
    id: nextId("ptd"),
    ownerTeamId: learner.ownerTeamId,
    learnerId: learner.id,
    contentPackageId: pkg.id,
    contentPackageVersion: pkg.version,
    subjectId: pkg.subjectId,
    modelId: learnerModel.id,
    targetKnowledgeId: target.id,
    targetTitle: target.title,
    strategy: "concept_rebuild",
    reasonCode: "user_selected_chapter",
    studentReason: `按你选择的章节，从“${target.title}”开始学习；不会把这个选择当成已经掌握的证据。`,
    misconception: null,
    evidenceAttemptIds: [],
    activationId,
    activationStatus: "active",
    exitConditions: ["能用自己的话解释核心内容并标明来源", "独立完成一道新题", "24 小时后复习仍能说明依据"],
    createdAt: now(),
  };
  state.privateTutorStrategyDecisions.unshift(strategyDecision);
  const preferences = privateTutorLearningPreferences(state, learner.id);
  const value = buildPrivateTutorSevenDayPlan({
    model: learnerModel,
    decision: strategyDecision,
    now,
    reason: "user_selected_chapter",
    scopeKnowledgeIds: selection.scopeKnowledgeIds,
    dailyMinutes: preferences.dailyMinutes,
    planIntensity: preferences.planIntensity,
    learningGoal: preferences.learningGoal,
  });
  const previousPlan = state.privateTutorLearningPlans.find((row) => row.learnerId === learner.id && row.contentPackageId === pkg.id);
  const learningPlan = {
    id: nextId("ptp"),
    ownerTeamId: learner.ownerTeamId,
    learnerId: learner.id,
    contentPackageId: pkg.id,
    contentPackageVersion: pkg.version,
    subjectId: pkg.subjectId,
    modelId: learnerModel.id,
    decisionId: strategyDecision.id,
    entryMode: "chapter",
    startModuleId: selection.moduleId,
    startTopicId: selection.topicId,
    startKnowledgeId: selection.knowledgeId,
    activationId,
    activationStatus: "active",
    revision: (previousPlan?.revision ?? 0) + 1,
    status: "active",
    ...value,
    updatedAt: value.generatedAt,
  };
  state.privateTutorLearningPlans.unshift(learningPlan);
  return { learnerModel, strategyDecision, learningPlan };
}

function ensureRuntimeCollections(state) {
  for (const key of ["privateTutorRuntimeValidations", "privateTutorPackageActivations"]) {
    if (!Array.isArray(state[key])) state[key] = [];
  }
}

function supersedePreviousLearningRuntime(state, learnerId, packageId, at) {
  for (const key of [
    "privateTutorAssessments",
    "privateTutorLearnerModels",
    "privateTutorStrategyDecisions",
    "privateTutorLearningPlans",
    "privateTutorSessions",
  ]) {
    for (const item of state[key] ?? []) {
      if (item.learnerId !== learnerId || item.contentPackageId !== packageId || item.activationStatus === "superseded") continue;
      item.activationStatus = "superseded";
      item.supersededAt = at;
    }
  }
}
