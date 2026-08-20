export const PRIVATE_TUTOR_KNOWLEDGE = [
  { id: "integer", title: "有理数运算", prerequisiteId: null, downstreamImpact: 4 },
  { id: "equation-meaning", title: "等式与方程", prerequisiteId: "integer", downstreamImpact: 3 },
  { id: "balance", title: "等式两边同乘同除", prerequisiteId: "equation-meaning", downstreamImpact: 5 },
  { id: "word-problem", title: "一元一次方程应用", prerequisiteId: "balance", downstreamImpact: 5 },
];

const KNOWLEDGE_BY_ID = new Map(PRIVATE_TUTOR_KNOWLEDGE.map((item) => [item.id, item]));

const MISCONCEPTIONS = {
  single_side_change: { label: "只改变了等式一边", recommendedStrategy: "concept_rebuild" },
  division_fluency: { label: "等式变形正确，但除法结果不稳定", recommendedStrategy: "fluency_practice" },
  negative_subtraction: { label: "减去负数时符号关系未站稳", recommendedStrategy: "prerequisite_repair" },
  equation_definition: { label: "还没有区分等式和含未知数的方程", recommendedStrategy: "concept_rebuild" },
  variable_isolation: { label: "还不清楚怎样让未知数单独留下", recommendedStrategy: "concept_rebuild" },
  equation_translation: { label: "文字关系还没有稳定转换为方程", recommendedStrategy: "concept_rebuild" },
  unresolved_method: { label: "当前方法还没有形成稳定证据", recommendedStrategy: "concept_rebuild" },
};

export function derivePrivateTutorLearnerModel({ snapshot, attempts, now }) {
  const at = now();
  const knowledge = PRIVATE_TUTOR_KNOWLEDGE.map((definition) => {
    const snapshotState = snapshot.knowledge.find((item) => item.id === definition.id) ?? {
      mastery: null,
      level: "unknown",
      evidenceCount: 0,
    };
    const evidence = attempts
      .filter((attempt) => attempt.knowledgeId === definition.id)
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
    const independentCorrect = evidence.filter((attempt) => attempt.correct && attempt.independent && !attempt.usedHint).length;
    const hintedCorrect = evidence.filter((attempt) => attempt.correct && attempt.usedHint).length;
    const incorrect = evidence.filter((attempt) => !attempt.correct).length;
    const latestEvidenceAt = evidence[0]?.createdAt ?? null;
    const misconception = inferMisconception(evidence);
    return {
      id: definition.id,
      title: definition.title,
      mastery: snapshotState.mastery,
      level: snapshotState.level,
      confidence: confidenceFor(snapshotState.mastery, snapshotState.evidenceCount, independentCorrect),
      evidenceCount: snapshotState.evidenceCount,
      independentCorrect,
      hintedCorrect,
      incorrect,
      hintDependency: evidence.length ? Number((evidence.filter((attempt) => attempt.usedHint).length / evidence.length).toFixed(2)) : 0,
      latestEvidenceAt,
      forgettingRisk: forgettingRisk(latestEvidenceAt, at),
      misconception,
      prerequisiteId: definition.prerequisiteId,
      prerequisiteGap: false,
      downstreamImpact: definition.downstreamImpact,
      recentAttemptIds: evidence.slice(0, 5).map((attempt) => attempt.id),
    };
  });
  for (const item of knowledge) {
    const prerequisite = knowledge.find((candidate) => candidate.id === item.prerequisiteId);
    item.prerequisiteGap = item.mastery != null
      && item.mastery < 0.75
      && prerequisite?.mastery != null
      && prerequisite.mastery < 0.55;
  }
  return { at, knowledge };
}

export function decidePrivateTutorStrategy({ model, attempts, previousDecision = null }) {
  const measured = model.knowledge.filter((item) => item.mastery != null);
  if (!measured.length) return null;
  const ranked = [...measured].sort((left, right) => priorityScore(right) - priorityScore(left));
  let target = ranked[0];
  let strategy;
  let reasonCode;
  let studentReason;
  if (target.prerequisiteGap) {
    target = model.knowledge.find((item) => item.id === target.prerequisiteId) ?? target;
    strategy = "prerequisite_repair";
    reasonCode = "prerequisite_gap";
    studentReason = `先把“${target.title}”补稳，后面的内容会更容易。`;
  } else if (target.misconception) {
    strategy = target.misconception.recommendedStrategy;
    reasonCode = `misconception:${target.misconception.id}`;
    studentReason = `最近的答案显示“${target.misconception.label}”，这次换一种更合适的方法。`;
  } else if (target.mastery >= 0.8) {
    strategy = "transfer_challenge";
    reasonCode = target.forgettingRisk >= 0.5 ? "delayed_retrieval_due" : "ready_for_transfer";
    studentReason = `“${target.title}”已经比较稳，换一道新情境确认真的会用。`;
  } else if (target.mastery >= 0.55) {
    strategy = "fluency_practice";
    reasonCode = "concept_present_needs_fluency";
    studentReason = `“${target.title}”已经理解，接下来用短练习让它更熟练。`;
  } else {
    strategy = "concept_rebuild";
    reasonCode = "concept_not_stable";
    studentReason = `“${target.title}”还没有站稳，我们用图和步骤重新理解。`;
  }

  const latestForTarget = attempts
    .filter((attempt) => attempt.knowledgeId === target.id)
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    .slice(0, 2);
  const repeatedError = latestForTarget.length === 2 && latestForTarget.every((attempt) => !attempt.correct);
  if (repeatedError && previousDecision?.targetKnowledgeId === target.id && previousDecision.strategy === strategy) {
    strategy = alternateStrategy(strategy);
    reasonCode = "method_changed_after_repeated_error";
    studentReason = `刚才的方法没有帮你弄懂“${target.title}”，现在换一种讲法。`;
  }

  return {
    targetKnowledgeId: target.id,
    targetTitle: target.title,
    strategy,
    reasonCode,
    studentReason,
    misconception: target.misconception,
    evidenceAttemptIds: target.recentAttemptIds,
    exitConditions: exitConditions(strategy, target.id),
  };
}

export function buildPrivateTutorSevenDayPlan({ model, decision, now, reason = "diagnostic_completed", carryForwardKnowledgeId = null }) {
  if (!decision) return null;
  const measured = model.knowledge
    .filter((item) => item.mastery != null)
    .sort((left, right) => priorityScore(right) - priorityScore(left));
  const primary = model.knowledge.find((item) => item.id === carryForwardKnowledgeId)
    ?? model.knowledge.find((item) => item.id === decision.targetKnowledgeId)
    ?? measured[0];
  const alternatives = measured.filter((item) => item.id !== primary.id);
  const secondary = alternatives[0] ?? primary;
  const tertiary = alternatives[1] ?? secondary;
  const pattern = [
    { item: primary, activity: "teach", strategy: decision.strategy, minutes: 20 },
    { item: secondary, activity: "repair", strategy: basicStrategy(secondary), minutes: 20 },
    { item: primary, activity: "independent_practice", strategy: "fluency_practice", minutes: 20 },
    { item: tertiary, activity: "teach", strategy: basicStrategy(tertiary), minutes: 20 },
    { item: primary, activity: "transfer", strategy: "transfer_challenge", minutes: 20 },
    { item: secondary, activity: "spaced_review", strategy: "transfer_challenge", minutes: 20 },
    { item: primary, activity: "mixed_check", strategy: "transfer_challenge", minutes: 20 },
  ];
  const generatedAt = now();
  return {
    generatedAt,
    reason,
    studentReason: reason === "missed_day_rescheduled"
      ? "昨天没完成也没关系，计划已经顺延，今天从最合适的位置继续。"
      : decision.studentReason,
    days: pattern.map(({ item, activity, strategy, minutes }, index) => ({
      dayIndex: index + 1,
      date: addDays(generatedAt, index),
      status: "planned",
      knowledgeId: item.id,
      knowledgeTitle: item.title,
      activity,
      title: activityTitle(activity, item.title),
      minutes,
      strategy,
      rationale: index === 0 ? decision.studentReason : rationale(activity, item.title),
    })),
  };
}

function inferMisconception(evidence) {
  const wrong = evidence.filter((attempt) => !attempt.correct);
  if (!wrong.length) return null;
  const ids = wrong.map((attempt) => misconceptionIdForAttempt(attempt));
  const counts = new Map();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  const [id, evidenceCount] = [...counts.entries()].sort((left, right) => right[1] - left[1])[0];
  return { id, ...MISCONCEPTIONS[id], evidenceCount };
}

function misconceptionIdForAttempt(attempt) {
  if (attempt.questionRevisionId === "diag-bal-01-v1") return "single_side_change";
  if (["diag-bal-02-v1", "diag-bal-03-v1", "demo-balance-001-v1"].includes(attempt.questionRevisionId)) return "division_fluency";
  if (attempt.questionRevisionId === "diag-int-03-v1") return "negative_subtraction";
  if (attempt.questionRevisionId === "diag-eqm-01-v1") return "equation_definition";
  if (String(attempt.knowledgeId) === "equation-meaning") return "variable_isolation";
  if (String(attempt.knowledgeId) === "word-problem") return "equation_translation";
  return "unresolved_method";
}

function confidenceFor(mastery, evidenceCount, independentCorrect) {
  if (mastery == null) return 0;
  return Math.min(0.95, Number((0.25 + Math.min(5, evidenceCount) * 0.12 + Math.min(3, independentCorrect) * 0.03).toFixed(2)));
}

function forgettingRisk(latestEvidenceAt, at) {
  if (!latestEvidenceAt) return 0;
  const days = Math.max(0, (Date.parse(at) - Date.parse(latestEvidenceAt)) / 86_400_000);
  if (days >= 14) return 0.8;
  if (days >= 7) return 0.55;
  if (days >= 3) return 0.3;
  return 0.1;
}

function priorityScore(item) {
  return (1 - item.mastery) * 2
    + item.forgettingRisk
    + item.downstreamImpact * 0.12
    + (item.prerequisiteGap ? 0.8 : 0)
    + (item.misconception ? 0.35 : 0);
}

function basicStrategy(item) {
  if (item.prerequisiteGap) return "prerequisite_repair";
  if (item.misconception) return item.misconception.recommendedStrategy;
  if (item.mastery >= 0.8) return "transfer_challenge";
  if (item.mastery >= 0.55) return "fluency_practice";
  return "concept_rebuild";
}

function alternateStrategy(strategy) {
  return {
    prerequisite_repair: "concept_rebuild",
    concept_rebuild: "prerequisite_repair",
    fluency_practice: "concept_rebuild",
    transfer_challenge: "concept_rebuild",
  }[strategy];
}

function exitConditions(strategy, knowledgeId) {
  const common = [`在 ${knowledgeId} 上独立完成一道新题`, "24 小时后复测仍能说明原因"];
  if (strategy === "prerequisite_repair") return ["前置知识连续两次独立正确", ...common];
  if (strategy === "concept_rebuild") return ["能用自己的话解释关键关系", ...common];
  if (strategy === "fluency_practice") return ["短组练习正确率稳定且不依赖提示", ...common];
  return ["能在新情境中迁移使用", ...common];
}

function activityTitle(activity, knowledgeTitle) {
  return {
    teach: `弄懂：${knowledgeTitle}`,
    repair: `补稳：${knowledgeTitle}`,
    independent_practice: `自己试试：${knowledgeTitle}`,
    transfer: `换个情境：${knowledgeTitle}`,
    spaced_review: `隔天回想：${knowledgeTitle}`,
    mixed_check: `综合复测：${knowledgeTitle}`,
  }[activity];
}

function rationale(activity, title) {
  if (activity === "spaced_review") return `隔一段时间再回想“${title}”，确认不是短时记住。`;
  if (activity === "transfer" || activity === "mixed_check") return `换一道新题验证“${title}”能否真正迁移。`;
  return `根据当前证据继续巩固“${title}”。`;
}

function addDays(isoDate, offset) {
  const date = new Date(isoDate);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
