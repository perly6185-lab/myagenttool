export const PRIVATE_TUTOR_EVALUATION_MIGRATION_REGISTRY_VERSION = 1;

export const privateTutorEvaluationMigrations = Object.freeze([
  migration({
    id: "math-authored-steps-v1-to-linear-equation-v2",
    suite: "math-step",
    from: descriptor("1.0.0", "1.0.0", null, "authored-checkpoints-v1"),
    to: descriptor("2.0.0", "1.0.0", "1.0.0", "linear-equation-v2"),
    rationale: "从固定步骤字符串匹配迁移到单变量一次方程符号等价判题。",
  }),
  migration({
    id: "language-authored-rubric-v1-to-causal-semantic-v2",
    suite: "language-semantic",
    from: descriptor("1.0.0", "1.0.0", null, "authored-rubric-v1"),
    to: descriptor("2.0.0", "2.0.0", "2.0.0", "causal-semantic-v2"),
    rationale: "从短语全匹配迁移到带否定、因果方向和语音置信度校准的语义判题。",
  }),
  migration({
    id: "concept-source-rubric-v1-to-anchored-rubric-v2",
    suite: "conceptual-rubric",
    from: descriptor("1.0.0", "1.0.0", null, "source-grounded-rubric-v1"),
    to: descriptor("2.0.0", "2.0.0", "2.0.0", "anchored-concept-rubric-v2"),
    rationale: "从全有或全无的来源量表迁移到加权分档、评分锚点和临界复核。",
  }),
]);

export function resolvePrivateTutorEvaluationMigration(suite, from, to, migrations = privateTutorEvaluationMigrations) {
  return migrations.find((item) => item.suite === suite && sameDescriptor(item.from, from) && sameDescriptor(item.to, to)) ?? null;
}

export function samePrivateTutorEvaluationVersion(left, right) {
  return sameDescriptor(left, right);
}

function migration({ id, suite, from, to, rationale }) {
  return Object.freeze({
    id,
    suite,
    from: Object.freeze(from),
    to: Object.freeze(to),
    compatibility: "breaking",
    historicalEvidencePolicy: "preserve_original_decision",
    migrationPolicy: "versioned_replay_and_review_required",
    reviewedDecisionChangeIds: Object.freeze([]),
    maximumAbsoluteScoreDrift: 0,
    status: "completed",
    rationale,
  });
}

function descriptor(evaluatorVersion, contentPackageVersion, rubricVersion, profile) {
  return { evaluatorVersion, contentPackageVersion, rubricVersion, profile };
}

function sameDescriptor(left, right) {
  return ["evaluatorVersion", "contentPackageVersion", "rubricVersion", "profile"]
    .every((key) => (left?.[key] ?? null) === (right?.[key] ?? null));
}
