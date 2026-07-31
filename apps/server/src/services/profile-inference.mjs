const INPUT_SCHEMA = "local-sanitized-profile-features/v1";
const OUTPUT_SCHEMA = "explainable-profile-candidates/v1";

export const PROFILE_INFERENCE_LIMITS = Object.freeze({
  maxCandidates: 5,
  maxFeatures: 32,
  maxObservations: 10_000,
  minCandidateConfidence: 0.2,
  minAutoApplyConfidence: 0.75,
  observationsForFullConfidence: 5,
});

export const PROFILE_CLASSIFICATION_VOCABULARY = Object.freeze([
  "interest.technology",
  "interest.product",
  "interest.content_creation",
  "work_style.planning",
  "work_style.collaboration",
  "communication.concise",
  "communication.detailed",
]);

const FEATURE_RULES = Object.freeze({
  technical_activity: Object.freeze({
    classification: "interest.technology",
    reason: "本地聚合特征显示技术主题活动占比较高",
  }),
  product_activity: Object.freeze({
    classification: "interest.product",
    reason: "本地聚合特征显示产品主题活动占比较高",
  }),
  content_creation_activity: Object.freeze({
    classification: "interest.content_creation",
    reason: "本地聚合特征显示内容创作主题活动占比较高",
  }),
  planning_workflow: Object.freeze({
    classification: "work_style.planning",
    reason: "本地聚合特征显示规划类工作流使用较多",
  }),
  collaboration_workflow: Object.freeze({
    classification: "work_style.collaboration",
    reason: "本地聚合特征显示协作类工作流使用较多",
  }),
  concise_response_preference: Object.freeze({
    classification: "communication.concise",
    reason: "本地聚合特征显示更常选择简洁响应",
  }),
  detailed_response_preference: Object.freeze({
    classification: "communication.detailed",
    reason: "本地聚合特征显示更常选择详细响应",
  }),
});

const ALLOWED_INPUT_FIELDS = new Set(["schema", "sanitized", "features"]);
const ALLOWED_FEATURE_FIELDS = new Set(["key", "score", "observations"]);
const VOCABULARY = new Set(PROFILE_CLASSIFICATION_VOCABULARY);
const REVIEW_PROJECTION = Object.freeze({
  "interest.technology": Object.freeze({ category: "domain", protocolKind: "category" }),
  "interest.product": Object.freeze({ category: "domain", protocolKind: "category" }),
  "interest.content_creation": Object.freeze({ category: "domain", protocolKind: "category" }),
  "work_style.planning": Object.freeze({ category: "work_type", protocolKind: "recurring_activity" }),
  "work_style.collaboration": Object.freeze({ category: "work_type", protocolKind: "recurring_activity" }),
  "communication.concise": Object.freeze({ category: "preference", protocolKind: "preferred_output" }),
  "communication.detailed": Object.freeze({ category: "preference", protocolKind: "preferred_output" }),
});

export class ProfileInferenceInputError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ProfileInferenceInputError";
    this.code = code;
  }
}

/**
 * Infer bounded, explainable profile candidates from local aggregate features.
 *
 * The boundary is intentionally narrow: callers must provide the sanitized
 * schema, and neither raw text nor arbitrary metadata is accepted or inspected.
 */
export function inferProfileCandidates(input, options = {}) {
  assertPlainObject(input, "invalid_input", "profile inference input must be an object");
  assertAllowedFields(input, ALLOWED_INPUT_FIELDS, "unauthorized_input_field");

  if (input.schema !== INPUT_SCHEMA || input.sanitized !== true) {
    throw new ProfileInferenceInputError(
      "unsanitized_input",
      `profile inference only accepts ${INPUT_SCHEMA}`,
    );
  }
  if (!Array.isArray(input.features)) {
    throw new ProfileInferenceInputError("invalid_features", "features must be an array");
  }
  if (input.features.length > PROFILE_INFERENCE_LIMITS.maxFeatures) {
    throw new ProfileInferenceInputError(
      "too_many_features",
      `features must contain at most ${PROFILE_INFERENCE_LIMITS.maxFeatures} entries`,
    );
  }

  const maxCandidates = boundedCandidateLimit(options.maxCandidates);
  const autoApplyThreshold = boundedAutoApplyThreshold(options.autoApplyThreshold);
  const bestByClassification = new Map();

  for (const feature of input.features) {
    const normalized = normalizeFeature(feature);
    const rule = FEATURE_RULES[normalized.key];
    const confidence = featureConfidence(normalized);
    if (confidence < PROFILE_INFERENCE_LIMITS.minCandidateConfidence) continue;

    const current = bestByClassification.get(rule.classification);
    if (!current || confidence > current.confidence) {
      bestByClassification.set(rule.classification, candidateFrom(rule, normalized, confidence, autoApplyThreshold));
    }
  }

  const ranked = [...bestByClassification.values()]
    .sort((left, right) => right.confidence - left.confidence
      || left.classification.localeCompare(right.classification));
  const candidates = ranked.slice(0, maxCandidates);

  return Object.freeze({
    schema: OUTPUT_SCHEMA,
    sourceSchema: INPUT_SCHEMA,
    taxonomy: "profile-classification/v1",
    autoApplyThreshold,
    candidates: Object.freeze(candidates),
    truncated: ranked.length > candidates.length,
  });
}

/**
 * Return only candidates permitted to take effect without user review.
 * Keeping this gate separate makes it difficult for consumers to accidentally
 * treat every inference candidate as an active profile value.
 */
export function autoApplicableProfileCandidates(inference) {
  if (!inference || inference.schema !== OUTPUT_SCHEMA || !Array.isArray(inference.candidates)) {
    throw new ProfileInferenceInputError("invalid_inference", "a profile inference result is required");
  }
  const threshold = Math.max(
    PROFILE_INFERENCE_LIMITS.minAutoApplyConfidence,
    Number.isFinite(inference.autoApplyThreshold) ? inference.autoApplyThreshold : 1,
  );
  return Object.freeze(inference.candidates.filter((candidate) =>
    candidate.autoApplyEligible === true
    && candidate.confidence >= threshold
    && VOCABULARY.has(candidate.classification)));
}

/**
 * Project an inference candidate into the durable, user-reviewable shape.
 *
 * The protocol model remains the canonical semantic vocabulary
 * (`protocolKind`, confidence level and source summary), while the flatter
 * category/value fields are an explicit UI projection. Even high-confidence
 * candidates begin as pending so a review screen never silently converts a
 * model suggestion into user truth.
 */
export function reviewableWorkProfileInference(candidate, {
  id,
  userId,
  ownerTeamId,
  project,
  createdAt,
} = {}) {
  const projection = REVIEW_PROJECTION[candidate?.classification];
  if (!projection || !VOCABULARY.has(candidate.classification)) {
    throw new ProfileInferenceInputError(
      "invalid_candidate",
      `unsupported profile candidate: ${String(candidate?.classification)}`,
    );
  }
  if (!id || !userId || !ownerTeamId || !project?.id || !project?.path || !createdAt) {
    throw new ProfileInferenceInputError(
      "invalid_review_context",
      "a durable id, owner, authorized project, and timestamp are required",
    );
  }
  const observationCount = candidate.evidence?.observations ?? 0;
  const sourceSummary = Object.freeze({
    summary: candidate.reason,
    sources: Object.freeze([Object.freeze({
      kind: "project",
      reference: project.id,
      observedAt: createdAt,
    })]),
    observationCount,
    observedFrom: createdAt,
    observedTo: createdAt,
  });
  return {
    id,
    schema: "work-profile-review-inference/v1",
    userId,
    ownerTeamId,
    sourceProjectId: project.id,
    category: projection.category,
    value: candidate.classification,
    protocolKind: projection.protocolKind,
    confidence: candidate.confidence,
    confidenceLevel: candidate.confidenceLevel,
    status: "pending",
    summary: candidate.reason,
    sourceSummary,
    evidence: [{
      projectId: project.id,
      projectName: project.name,
      authorizedDirectory: project.path,
      signal: candidate.evidence?.feature ?? "sanitized_aggregate",
      score: candidate.evidence?.score ?? null,
      observations: observationCount,
    }],
    autoApplyEligible: candidate.autoApplyEligible === true,
    createdAt,
    updatedAt: createdAt,
  };
}

function normalizeFeature(feature) {
  assertPlainObject(feature, "invalid_feature", "each feature must be an object");
  assertAllowedFields(feature, ALLOWED_FEATURE_FIELDS, "unauthorized_feature_field");

  if (!Object.hasOwn(FEATURE_RULES, feature.key)) {
    throw new ProfileInferenceInputError("unknown_feature", `unsupported sanitized feature: ${String(feature.key)}`);
  }
  if (!Number.isFinite(feature.score) || feature.score < 0 || feature.score > 1) {
    throw new ProfileInferenceInputError("invalid_feature_score", "feature score must be between 0 and 1");
  }
  if (!Number.isSafeInteger(feature.observations)
    || feature.observations < 1
    || feature.observations > PROFILE_INFERENCE_LIMITS.maxObservations) {
    throw new ProfileInferenceInputError(
      "invalid_feature_observations",
      `feature observations must be an integer between 1 and ${PROFILE_INFERENCE_LIMITS.maxObservations}`,
    );
  }
  return feature;
}

function candidateFrom(rule, feature, confidence, autoApplyThreshold) {
  const autoApplyEligible = confidence >= autoApplyThreshold;
  return Object.freeze({
    classification: rule.classification,
    confidence,
    confidenceLevel: confidenceLevel(confidence),
    reason: `${rule.reason}（${feature.observations} 次聚合观测）`,
    evidence: Object.freeze({
      feature: feature.key,
      score: feature.score,
      observations: feature.observations,
    }),
    autoApplyEligible,
    status: autoApplyEligible ? "auto_applicable" : "needs_review",
  });
}

function featureConfidence(feature) {
  const evidenceFactor = Math.min(
    1,
    feature.observations / PROFILE_INFERENCE_LIMITS.observationsForFullConfidence,
  );
  return roundConfidence(feature.score * evidenceFactor);
}

function confidenceLevel(confidence) {
  if (confidence >= PROFILE_INFERENCE_LIMITS.minAutoApplyConfidence) return "high";
  if (confidence >= 0.5) return "medium";
  return "low";
}

function boundedCandidateLimit(value) {
  if (value === undefined) return PROFILE_INFERENCE_LIMITS.maxCandidates;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ProfileInferenceInputError("invalid_candidate_limit", "maxCandidates must be a positive integer");
  }
  return Math.min(value, PROFILE_INFERENCE_LIMITS.maxCandidates);
}

function boundedAutoApplyThreshold(value) {
  if (value === undefined) return PROFILE_INFERENCE_LIMITS.minAutoApplyConfidence;
  if (!Number.isFinite(value)
    || value < PROFILE_INFERENCE_LIMITS.minAutoApplyConfidence
    || value > 1) {
    throw new ProfileInferenceInputError(
      "invalid_auto_apply_threshold",
      `autoApplyThreshold must be between ${PROFILE_INFERENCE_LIMITS.minAutoApplyConfidence} and 1`,
    );
  }
  return value;
}

function assertPlainObject(value, code, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProfileInferenceInputError(code, message);
  }
}

function assertAllowedFields(value, allowed, code) {
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected) {
    throw new ProfileInferenceInputError(code, `field is not authorized for profile inference: ${unexpected}`);
  }
}

function roundConfidence(value) {
  return Math.round(value * 1_000) / 1_000;
}
