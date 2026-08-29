import { privateTutorPackageRegistryFromState } from "./private-tutor-package-registry.mjs";

export const PRIVATE_TUTOR_LEARNING_HISTORY_SCHEMA_VERSION = 1;

export function buildPrivateTutorLearningHistory(state, learnerId, {
  at = new Date().toISOString(),
  recentSessionLimit = 20,
  learningProfileId = null,
} = {}) {
  const registry = privateTutorPackageRegistryFromState(state);
  const attempts = rowsForLearner(state.privateTutorAttempts, learnerId);
  const sessions = rowsForLearner(state.privateTutorSessions, learnerId);
  const plans = rowsForLearner(state.privateTutorLearningPlans, learnerId);
  const assessments = rowsForLearner(state.privateTutorAssessments, learnerId);
  const activations = rowsForLearner(state.privateTutorPackageActivations, learnerId);
  const keys = new Set([
    ...attempts.map(packageVersionKey),
    ...sessions.map(packageVersionKey),
    ...plans.map(packageVersionKey),
    ...assessments.map(packageVersionKey),
    ...activations.map(packageVersionKey),
  ].filter(Boolean));

  const packages = [...keys].map((key) => {
    const [packageId, packageVersion] = splitPackageVersionKey(key);
    const resolvedPackage = registry.getPackage(packageId);
    const pkg = resolvedPackage?.sourceType === "user_material"
      && learningProfileId
      && resolvedPackage.learningProfileId !== learningProfileId
      ? null
      : resolvedPackage;
    const definitionAvailable = pkg?.version === packageVersion;
    const packageAttempts = attempts.filter((item) => packageVersionKey(item) === key);
    const packageSessions = sessions.filter((item) => packageVersionKey(item) === key);
    const packagePlans = plans.filter((item) => packageVersionKey(item) === key);
    const packageAssessments = assessments.filter((item) => packageVersionKey(item) === key);
    const packageActivations = activations.filter((item) => packageVersionKey(item) === key);
    const chapterIndex = definitionAvailable ? buildChapterIndex(pkg) : emptyChapterIndex();
    const chapters = buildChapterHistory({
      chapterIndex,
      attempts: packageAttempts,
      sessions: packageSessions,
      plans: packagePlans,
      at,
    });
    const summary = summarizeHistory({
      attempts: packageAttempts,
      sessions: packageSessions,
      plans: packagePlans,
      at,
    });
    const activityTimes = [
      ...packageAttempts.map((item) => item.createdAt),
      ...packageSessions.flatMap((item) => [item.startedAt, item.completedAt]),
      ...packageAssessments.flatMap((item) => [item.startedAt, item.completedAt]),
      ...packageActivations.map((item) => item.activatedAt),
    ].filter(Boolean).sort();
    return {
      packageId,
      packageVersion,
      packageName: pkg?.name ?? packageId,
      sourceType: pkg?.sourceType ?? null,
      packageStatus: pkg?.status ?? (pkg ? "published" : "historical"),
      contentDefinitionAvailable: definitionAvailable,
      firstActivityAt: activityTimes[0] ?? null,
      lastActivityAt: activityTimes.at(-1) ?? null,
      activationCount: packageActivations.length,
      assessmentCount: packageAssessments.length,
      completedAssessmentCount: packageAssessments.filter((item) => item.status === "completed").length,
      summary,
      chapters,
      recentSessions: packageSessions
        .slice()
        .sort((left, right) => timestamp(right.updatedAt ?? right.startedAt).localeCompare(timestamp(left.updatedAt ?? left.startedAt)))
        .slice(0, boundedLimit(recentSessionLimit))
        .map((session) => sessionHistoryView(session, chapterIndex)),
    };
  }).sort((left, right) => timestamp(right.lastActivityAt).localeCompare(timestamp(left.lastActivityAt)));

  return {
    schemaVersion: PRIVATE_TUTOR_LEARNING_HISTORY_SCHEMA_VERSION,
    learnerId,
    generatedAt: at,
    definitions: {
      planDayCompletionRate: "已完成计划日数 / 已实际开始计划日数",
      evidenceEligibilityRate: "可形成掌握证据的作答数 / 全部作答数",
      independentCorrectRate: "独立且正确的作答数 / 全部独立作答数",
      reviewCompletionRate: "已完成人工复核数 / 曾要求人工复核数",
      dueReview: "学习会话约定复习时间已到，且之后尚无同知识点的独立有效证据",
    },
    summary: {
      ...mergeSummaries(packages.map((item) => item.summary), packages.length),
      chapterCount: packages.reduce((sum, item) => sum + item.chapters.length, 0),
    },
    packages,
  };
}

function buildChapterHistory({ chapterIndex, attempts, sessions, plans, at }) {
  const chapterIds = new Set([
    ...chapterIndex.chapters.keys(),
    ...attempts.map((item) => chapterForKnowledge(chapterIndex, item.knowledgeId).id),
    ...sessions.map((item) => chapterForKnowledge(chapterIndex, item.targetKnowledgeId).id),
  ]);
  const values = [...chapterIds].map((chapterId) => {
    const definition = chapterIndex.chapters.get(chapterId) ?? unmappedChapter();
    const knowledgeIds = new Set(definition.knowledgeIds);
    const chapterAttempts = attempts.filter((item) => knowledgeIds.has(item.knowledgeId)
      || (chapterId === "unmapped" && !chapterIndex.knowledge.has(item.knowledgeId)));
    const chapterSessions = sessions.filter((item) => knowledgeIds.has(item.targetKnowledgeId)
      || (chapterId === "unmapped" && !chapterIndex.knowledge.has(item.targetKnowledgeId)));
    const chapterPlans = plans.map((plan) => ({
      ...plan,
      days: (plan.days ?? []).filter((day) => knowledgeIds.has(day.knowledgeId)
        || (chapterId === "unmapped" && !chapterIndex.knowledge.has(day.knowledgeId))),
    })).filter((plan) => plan.days.length > 0);
    const activityTimes = [
      ...chapterAttempts.map((item) => item.createdAt),
      ...chapterSessions.flatMap((item) => [item.startedAt, item.completedAt]),
    ].filter(Boolean).sort();
    return {
      moduleId: definition.id,
      moduleName: definition.name,
      orderIndex: definition.orderIndex,
      knowledgeCount: definition.knowledgeIds.length,
      firstActivityAt: activityTimes[0] ?? null,
      lastActivityAt: activityTimes.at(-1) ?? null,
      summary: summarizeHistory({ attempts: chapterAttempts, sessions: chapterSessions, plans: chapterPlans, at }),
      topics: definition.topics.map((topic) => ({
        topicId: topic.id,
        topicName: topic.name,
        knowledgeIds: [...topic.knowledgeIds],
      })),
    };
  });
  return values
    .filter((item) => item.firstActivityAt || item.summary.currentPlan.scheduledDays > 0)
    .sort((left, right) => left.orderIndex - right.orderIndex || left.moduleName.localeCompare(right.moduleName));
}

function summarizeHistory({ attempts, sessions, plans, at }) {
  const startedPlanDays = new Set(sessions
    .filter((item) => item.planId && Number.isInteger(item.planDayIndex))
    .map((item) => `${item.planId}:${item.planDayIndex}`));
  const completedPlanDays = new Set(sessions
    .filter((item) => item.status === "completed" && item.planId && Number.isInteger(item.planDayIndex))
    .map((item) => `${item.planId}:${item.planDayIndex}`));
  const latestPlan = plans.slice().sort((left, right) =>
    timestamp(right.updatedAt ?? right.generatedAt).localeCompare(timestamp(left.updatedAt ?? left.generatedAt)))[0] ?? null;
  const independent = attempts.filter((item) => item.independent === true && item.usedHint !== true);
  const eligible = attempts.filter((item) => item.evidenceEligible !== false);
  const rubricAttempts = attempts.filter(isSourceRubricAttempt);
  const requiredReviews = rubricAttempts.filter((item) => ["required", "completed"].includes(item.evaluation?.reviewStatus));
  const completedReviews = requiredReviews.filter((item) => item.evaluation?.reviewStatus === "completed");
  const reviewObligations = sessions.flatMap((session) => {
    const reviewAt = session.summary?.reviewAt;
    if (session.status !== "completed" || !reviewAt) return [];
    const completed = attempts.some((attempt) => attempt.knowledgeId === session.targetKnowledgeId
      && attempt.independent === true
      && attempt.usedHint !== true
      && attempt.evidenceEligible !== false
      && timestamp(attempt.createdAt).localeCompare(timestamp(reviewAt)) >= 0);
    return [{ reviewAt, completed }];
  });
  const due = reviewObligations.filter((item) => !item.completed && timestamp(item.reviewAt).localeCompare(timestamp(at)) <= 0).length;
  const upcoming = reviewObligations.filter((item) => !item.completed && timestamp(item.reviewAt).localeCompare(timestamp(at)) > 0).length;
  const completed = reviewObligations.filter((item) => item.completed).length;
  const currentDays = latestPlan?.days ?? [];
  return {
    sessionCount: sessions.length,
    completedSessionCount: sessions.filter((item) => item.status === "completed").length,
    startedPlanDayCount: startedPlanDays.size,
    completedPlanDayCount: completedPlanDays.size,
    planDayCompletionRate: rate(completedPlanDays.size, startedPlanDays.size),
    currentPlan: {
      planId: latestPlan?.id ?? null,
      status: latestPlan?.status ?? null,
      scheduledDays: currentDays.filter((item) => !["rest", "rescheduled"].includes(item.status)).length,
      completedDays: currentDays.filter((item) => item.status === "completed").length,
      inProgressDays: currentDays.filter((item) => item.status === "in_progress").length,
      restDays: currentDays.filter((item) => item.status === "rest").length,
    },
    practiceAttemptCount: attempts.length,
    eligibleEvidenceCount: eligible.length,
    evidenceEligibilityRate: rate(eligible.length, attempts.length),
    independentAttemptCount: independent.length,
    independentCorrectCount: independent.filter((item) => item.correct === true).length,
    independentCorrectRate: rate(independent.filter((item) => item.correct === true).length, independent.length),
    review: {
      scheduledCount: reviewObligations.length,
      completedCount: completed,
      dueCount: due,
      upcomingCount: upcoming,
    },
    sourceRubric: {
      attemptCount: rubricAttempts.length,
      requiredReviewCount: requiredReviews.length,
      completedReviewCount: completedReviews.length,
      pendingReviewCount: requiredReviews.length - completedReviews.length,
      reviewCompletionRate: rate(completedReviews.length, requiredReviews.length),
    },
  };
}

function mergeSummaries(summaries, packageCount) {
  const total = {
    packageCount,
    sessionCount: 0,
    completedSessionCount: 0,
    startedPlanDayCount: 0,
    completedPlanDayCount: 0,
    practiceAttemptCount: 0,
    eligibleEvidenceCount: 0,
    independentAttemptCount: 0,
    independentCorrectCount: 0,
    scheduledReviewCount: 0,
    completedReviewCount: 0,
    dueReviewCount: 0,
    upcomingReviewCount: 0,
    sourceRubricAttemptCount: 0,
    sourceRubricRequiredReviewCount: 0,
    sourceRubricCompletedReviewCount: 0,
  };
  for (const summary of summaries) {
    total.sessionCount += summary.sessionCount;
    total.completedSessionCount += summary.completedSessionCount;
    total.startedPlanDayCount += summary.startedPlanDayCount;
    total.completedPlanDayCount += summary.completedPlanDayCount;
    total.practiceAttemptCount += summary.practiceAttemptCount;
    total.eligibleEvidenceCount += summary.eligibleEvidenceCount;
    total.independentAttemptCount += summary.independentAttemptCount;
    total.independentCorrectCount += summary.independentCorrectCount;
    total.scheduledReviewCount += summary.review.scheduledCount;
    total.completedReviewCount += summary.review.completedCount;
    total.dueReviewCount += summary.review.dueCount;
    total.upcomingReviewCount += summary.review.upcomingCount;
    total.sourceRubricAttemptCount += summary.sourceRubric.attemptCount;
    total.sourceRubricRequiredReviewCount += summary.sourceRubric.requiredReviewCount;
    total.sourceRubricCompletedReviewCount += summary.sourceRubric.completedReviewCount;
  }
  return {
    ...total,
    planDayCompletionRate: rate(total.completedPlanDayCount, total.startedPlanDayCount),
    evidenceEligibilityRate: rate(total.eligibleEvidenceCount, total.practiceAttemptCount),
    independentCorrectRate: rate(total.independentCorrectCount, total.independentAttemptCount),
    sourceRubricReviewCompletionRate: rate(total.sourceRubricCompletedReviewCount, total.sourceRubricRequiredReviewCount),
  };
}

function buildChapterIndex(pkg) {
  const chapters = new Map();
  const knowledge = new Map();
  for (const module of pkg.modules ?? []) {
    const topics = (module.topics ?? []).map((topic) => {
      const knowledgeIds = (topic.knowledgeComponentIds ?? topic.knowledgeComponents?.map((item) => item.id) ?? []).filter(Boolean);
      return { id: topic.id, name: topic.name ?? topic.id, knowledgeIds };
    });
    const chapter = {
      id: module.id,
      name: module.name ?? module.id,
      orderIndex: Number(module.orderIndex ?? chapters.size + 1),
      knowledgeIds: [...new Set(topics.flatMap((topic) => topic.knowledgeIds))],
      topics,
    };
    chapters.set(chapter.id, chapter);
    for (const topic of topics) for (const knowledgeId of topic.knowledgeIds) {
      knowledge.set(knowledgeId, { chapterId: chapter.id, topicId: topic.id });
    }
  }
  return { chapters, knowledge };
}

function emptyChapterIndex() {
  return { chapters: new Map(), knowledge: new Map() };
}

function chapterForKnowledge(index, knowledgeId) {
  const mapped = index.knowledge.get(knowledgeId);
  return mapped ? index.chapters.get(mapped.chapterId) : unmappedChapter();
}

function unmappedChapter() {
  return { id: "unmapped", name: "历史章节（当前版本未映射）", orderIndex: Number.MAX_SAFE_INTEGER, knowledgeIds: [], topics: [] };
}

function sessionHistoryView(session, chapterIndex) {
  const chapter = chapterForKnowledge(chapterIndex, session.targetKnowledgeId);
  return {
    id: session.id,
    status: session.status,
    moduleId: chapter.id,
    moduleName: chapter.name,
    knowledgeId: session.targetKnowledgeId,
    knowledgeTitle: session.targetTitle ?? session.targetKnowledgeId,
    planId: session.planId ?? null,
    planDayIndex: session.planDayIndex ?? null,
    practiceCount: session.summary?.practiceCount ?? session.practiceAttemptIds?.length ?? session.evidenceAttemptIds?.length ?? 0,
    evidenceCount: session.summary?.evidenceCount ?? session.evidenceAttemptIds?.length ?? 0,
    startedAt: session.startedAt ?? null,
    completedAt: session.completedAt ?? null,
    reviewAt: session.summary?.reviewAt ?? null,
  };
}

function isSourceRubricAttempt(attempt) {
  return Boolean(attempt.evaluation?.rubricVersion
    || attempt.evaluation?.runtimeValidationId
    || String(attempt.evidenceTier ?? "").includes("rubric"));
}

function packageVersionKey(item) {
  const packageId = String(item?.contentPackageId ?? item?.packageId ?? "").trim();
  const packageVersion = String(item?.contentPackageVersion ?? item?.packageVersion ?? "").trim();
  return packageId && packageVersion ? `${encodeURIComponent(packageId)}::${encodeURIComponent(packageVersion)}` : null;
}

function splitPackageVersionKey(key) {
  const [packageId, packageVersion] = key.split("::");
  return [decodeURIComponent(packageId), decodeURIComponent(packageVersion)];
}

function rowsForLearner(rows, learnerId) {
  return Array.isArray(rows) ? rows.filter((item) => item.learnerId === learnerId) : [];
}

function boundedLimit(value) {
  return Math.max(1, Math.min(100, Number(value) || 20));
}

function rate(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(4)) : null;
}

function timestamp(value) {
  return String(value ?? "");
}
