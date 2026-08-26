import { createHash } from "node:crypto";

export const AUTHORED_CONTENT_SCHEMA_VERSION = 1;
export const AUTHORED_CONTENT_GENERATOR_VERSION = "source-template-v1";

const MAX_CONTENT_VERSIONS = 10;
const MAX_AUTHORED_KNOWLEDGE = 250;
const MAX_TEXT = 2_000;
const MAX_CONTENT_PAYLOAD_BYTES = 5_000_000;
const INVALID_SOURCE_TEXT = /%PDF-|\bendstream\b|\bxref\b|\uFFFD{3,}/i;

export function generateAuthoredContentVersion(state, draftId, {
  actorId,
  forceRegenerate = false,
  now = new Date().toISOString(),
} = {}) {
  const draft = findDraft(state, draftId);
  assertMapConfirmed(draft);
  if (!actorId) throw new Error("authored_content_actor_required");
  if (draft.draftKnowledgeComponents.length > MAX_AUTHORED_KNOWLEDGE) throw new Error("authored_content_too_large");

  const versions = authoredVersions(draft);
  const active = activeAuthoredContentVersion(draft);
  if (!forceRegenerate && active?.sourceMapFingerprint === draft.confirmation.fingerprint) return active;
  if (versions.length >= MAX_CONTENT_VERSIONS) throw new Error("authored_content_version_limit_reached");

  if (active && active.status !== "published") active.status = "superseded";
  const versionNumber = Math.max(0, ...versions.map((item) => Number(item.version) || 0)) + 1;
  const content = {
    id: `${draft.id}_content_v${versionNumber}`,
    draftId: draft.id,
    learningProfileId: draft.learningProfileId,
    schemaVersion: AUTHORED_CONTENT_SCHEMA_VERSION,
    generatorVersion: AUTHORED_CONTENT_GENERATOR_VERSION,
    version: versionNumber,
    revision: 1,
    sourceMapRevision: draft.revision,
    sourceMapFingerprint: draft.confirmation.fingerprint,
    status: "in_review",
    knowledgeContents: draft.draftKnowledgeComponents.map(authorKnowledgeContent),
    validationIssues: [],
    confirmation: null,
    generatedBy: actorId,
    generatedAt: now,
    updatedAt: now,
  };
  content.validationIssues = validateAuthoredContentVersion(draft, content);
  versions.push(content);
  draft.activeAuthoredContentVersion = versionNumber;
  draft.status = "content_in_review";
  draft.updatedAt = now;
  return content;
}

export function updateAuthoredContentVersion(state, draftId, patch, now = new Date().toISOString()) {
  const draft = findDraft(state, draftId);
  if (draft.status === "published") throw new Error("cannot_edit_published_draft");
  assertMapConfirmed(draft);
  const content = requireActiveContent(draft);
  if (content.sourceMapFingerprint !== draft.confirmation.fingerprint) throw new Error("authored_content_source_map_changed");
  if (patch?.knowledgeContents != null) {
    content.knowledgeContents = boundedObjectArray(patch.knowledgeContents, MAX_AUTHORED_KNOWLEDGE, "invalid_authored_knowledge_contents");
  }
  content.revision += 1;
  content.confirmation = null;
  content.status = "in_review";
  content.updatedAt = now;
  content.validationIssues = validateAuthoredContentVersion(draft, content);
  draft.status = "content_in_review";
  draft.updatedAt = now;
  return content;
}

export function confirmAuthoredContentVersion(state, draftId, {
  actorId,
  expectedRevision,
  acknowledgeContentReview,
  now = new Date().toISOString(),
} = {}) {
  const draft = findDraft(state, draftId);
  assertMapConfirmed(draft);
  const content = requireActiveContent(draft);
  if (!actorId || acknowledgeContentReview !== true) throw new Error("authored_content_review_acknowledgement_required");
  if (!Number.isSafeInteger(Number(expectedRevision)) || Number(expectedRevision) !== content.revision) {
    throw new Error("authored_content_revision_conflict");
  }
  content.validationIssues = validateAuthoredContentVersion(draft, content);
  if (content.validationIssues.some((issue) => issue.severity === "error")) {
    throw new Error("authored_content_has_validation_errors");
  }
  content.confirmation = {
    revision: content.revision,
    fingerprint: authoredContentFingerprint(content),
    confirmedBy: actorId,
    confirmedAt: now,
    acknowledgement: "teaching_content_and_rubrics_reviewed",
  };
  content.status = "confirmed";
  content.updatedAt = now;
  draft.status = "content_confirmed";
  draft.updatedAt = now;
  return content;
}

export function validateAuthoredContentVersion(draft, content) {
  const issues = [];
  const knowledge = Array.isArray(draft?.draftKnowledgeComponents) ? draft.draftKnowledgeComponents : [];
  const authored = Array.isArray(content?.knowledgeContents) ? content.knowledgeContents : [];
  if (content?.schemaVersion !== AUTHORED_CONTENT_SCHEMA_VERSION) addIssue(issues, "unsupported_authored_content_schema", "教学内容版本结构不受支持。", "error");
  if (content?.generatorVersion !== AUTHORED_CONTENT_GENERATOR_VERSION) addIssue(issues, "unsupported_authored_content_generator", "教学内容生成器版本不受支持。", "error");
  if (content?.sourceMapRevision !== draft?.revision || content?.sourceMapFingerprint !== draft?.confirmation?.fingerprint) {
    addIssue(issues, "authored_content_source_map_changed", "知识地图已变化，需要重新生成教学内容。", "error");
  }
  if (authored.length !== knowledge.length || authored.length === 0) {
    addIssue(issues, "authored_content_coverage_incomplete", "每个知识点都必须有完整教学内容。", "error");
  }

  const knowledgeMap = new Map(knowledge.map((item) => [item.id, item]));
  const seenKnowledge = new Set();
  const questionIds = new Set();
  for (const item of authored) {
    const sourceKnowledge = knowledgeMap.get(item?.knowledgeId);
    if (!sourceKnowledge || seenKnowledge.has(item.knowledgeId)) {
      addIssue(issues, "invalid_authored_knowledge_reference", `教学内容 ${item?.knowledgeId ?? "unknown"} 未对应唯一知识点。`, "error");
      continue;
    }
    seenKnowledge.add(item.knowledgeId);
    const expectedRefs = knowledgeSourceRefs(sourceKnowledge);
    if (!sameSourceRefs(item.sourceRefs, expectedRefs)) {
      addIssue(issues, "authored_content_source_mismatch", `知识点 ${item.knowledgeId} 的教学内容来源不匹配。`, "error");
    }
    const sourceText = expectedRefs.map((ref) => normalizeText(ref.excerpt)).filter(Boolean).join(" ");
    const explanation = boundedText(item?.teachingContent?.explanation, MAX_TEXT);
    if (!explanation || INVALID_SOURCE_TEXT.test(explanation) || !sourceText.includes(normalizeText(explanation))) {
      addIssue(issues, "authored_explanation_not_grounded", `知识点 ${item.knowledgeId} 的讲解未锚定原文。`, "error");
    }
    if (item?.teachingContent?.provenance !== "source_excerpt") {
      addIssue(issues, "authored_explanation_provenance_missing", `知识点 ${item.knowledgeId} 的讲解缺少来源标记。`, "error");
    }
    if (item?.teachingContent?.coreConcept !== sourceKnowledge.name
      || item?.teachingContent?.guidanceProvenance !== "rule_extracted"
      || !boundedText(item?.teachingContent?.guidance, 1_000)
      || INVALID_SOURCE_TEXT.test(item?.teachingContent?.guidance ?? "")
      || !boundedStringArray(item?.teachingContent?.keyPoints, 20, 500)
      || !boundedStringArray(item?.teachingContent?.hints, 10, 500)) {
      addIssue(issues, "invalid_authored_teaching_guidance", `知识点 ${item.knowledgeId} 的教学引导无效。`, "error");
    }
    for (const [field, minimum, context] of [["diagnosticQuestions", 1, "diagnostic"], ["tutoringQuestions", 3, "tutoring"], ["dailyQuestions", 1, "practice"], ["reviewQuestions", 1, "review"]]) {
      const questions = Array.isArray(item?.[field]) ? item[field] : [];
      if (questions.length < minimum || questions.length > 20) addIssue(issues, "authored_question_set_incomplete", `知识点 ${item.knowledgeId} 的 ${field} 数量无效。`, "error");
      for (const question of questions) validateQuestion(issues, question, item, expectedRefs, sourceText, questionIds, context);
    }
  }
  return issues;
}

export function authoredContentFingerprint(content) {
  return createHash("sha256").update(JSON.stringify({
    schemaVersion: content.schemaVersion,
    generatorVersion: content.generatorVersion,
    version: content.version,
    revision: content.revision,
    sourceMapRevision: content.sourceMapRevision,
    sourceMapFingerprint: content.sourceMapFingerprint,
    knowledgeContents: content.knowledgeContents,
  })).digest("hex");
}

export function activeAuthoredContentVersion(draft) {
  const activeVersion = Number(draft?.activeAuthoredContentVersion);
  return authoredVersions(draft).find((item) => item.version === activeVersion) ?? null;
}

export function requireConfirmedAuthoredContent(draft) {
  const content = requireActiveContent(draft);
  const fingerprint = authoredContentFingerprint(content);
  if (content.status !== "confirmed"
    || content.sourceMapFingerprint !== draft.confirmation?.fingerprint
    || content.confirmation?.revision !== content.revision
    || content.confirmation?.fingerprint !== fingerprint) {
    throw new Error("authored_content_confirmation_required");
  }
  const issues = validateAuthoredContentVersion(draft, content);
  if (issues.some((issue) => issue.severity === "error")) throw new Error("authored_content_has_validation_errors");
  return content;
}

function authorKnowledgeContent(knowledge) {
  const refs = knowledgeSourceRefs(knowledge);
  const referenceAnswer = refs.map((ref) => normalizeText(ref.excerpt)).filter(Boolean).join(" ").slice(0, 1_200);
  const sourceKeys = [...new Set(refs.map((ref) => ref.sectionId))];
  const rubric = createRubric(knowledge, sourceKeys, referenceAnswer);
  return {
    knowledgeId: knowledge.id,
    sourceRefs: structuredClone(refs),
    teachingContent: {
      coreConcept: knowledge.name,
      explanation: referenceAnswer,
      provenance: "source_excerpt",
      guidance: `围绕“${knowledge.name}”先核对原文，再用自己的话解释。`,
      guidanceProvenance: "rule_extracted",
      keyPoints: [...knowledge.learningObjectives],
      hints: [`先定位 ${sourceKeys.map((key) => `[ref:${key}]`).join("、")}。`, "回答时区分原文信息与自己的推断。"],
      methods: { default: "source-read-explain-apply-review" },
    },
    diagnosticQuestions: [createQuestion(knowledge, "diagnostic", 1, "依据原文说明", rubric, referenceAnswer, sourceKeys)],
    tutoringQuestions: [
      createQuestion(knowledge, "tutoring", 1, "用自己的话复述", rubric, referenceAnswer, sourceKeys),
      createQuestion(knowledge, "tutoring", 2, "结合原文细节解释", rubric, referenceAnswer, sourceKeys),
      createQuestion(knowledge, "tutoring", 3, "说明如何应用或辨析", rubric, referenceAnswer, sourceKeys),
    ],
    dailyQuestions: [createQuestion(knowledge, "practice", 1, "独立解释并引用来源", rubric, referenceAnswer, sourceKeys)],
    reviewQuestions: [createQuestion(knowledge, "review", 1, "不看提示回忆核心内容", rubric, referenceAnswer, sourceKeys)],
  };
}

function createQuestion(knowledge, context, index, action, rubric, referenceAnswer, sourceKeys) {
  const id = `${stableScopedId(knowledge.id)}-${context}-${index}-v1`;
  return {
    id,
    questionId: id.replace(/-v\d+$/, ""),
    knowledgeId: knowledge.id,
    context,
    difficulty: context === "diagnostic" ? 1 : context === "review" ? 2 : 2,
    kind: "rubric_response",
    prompt: `${action}“${knowledge.name}”，并使用 ${sourceKeys.map((key) => `[ref:${key}]`).join(" 或 ")} 标明依据。`,
    referenceAnswer,
    requiredSourceRefs: [...sourceKeys],
    sourceRefs: structuredClone(knowledgeSourceRefs(knowledge)),
    rubric: structuredClone(rubric),
    evidencePolicy: "practice_only_until_runtime_validation",
    provenance: "rule_extracted",
  };
}

function createRubric(knowledge, sourceKeys, referenceAnswer) {
  const terms = sourceTerms(knowledge, referenceAnswer);
  const primaryRef = sourceKeys[0];
  const allCitations = sourceKeys.map((key) => `[ref:${key}]`).join(" ");
  const criteria = [
    { id: "concept", label: `指出“${knowledge.name}”的核心含义`, weight: 0.35, acceptedPhrases: [terms[0]], partialPhrases: [], sourceRef: primaryRef },
    { id: "detail", label: "包含原文中的关键细节", weight: 0.3, acceptedPhrases: [terms[1] ?? terms[0]], partialPhrases: [], sourceRef: primaryRef },
    { id: "explanation", label: "把概念与关键细节组织成完整解释", weight: 0.2, acceptedPhrases: [terms[2] ?? terms[1] ?? terms[0]], partialPhrases: [], sourceRef: primaryRef },
  ];
  const proficientPhrases = [...new Set(criteria.map((criterion) => criterion.acceptedPhrases[0]).filter(Boolean))];
  return {
    version: "2.0.0",
    profile: "anchored-concept-rubric-v2",
    passBand: "proficient",
    reviewThreshold: 0.75,
    sourceWeight: 0.15,
    requiredSourceRefs: [...sourceKeys],
    availableSourceRefs: [...sourceKeys],
    bands: [
      { id: "insufficient", minScore: 0, maxScore: 0.49 },
      { id: "developing", minScore: 0.5, maxScore: 0.89 },
      { id: "proficient", minScore: 0.9, maxScore: 1 },
    ],
    anchors: [
      { id: `${stableScopedId(knowledge.id)}-anchor-insufficient-v1`, band: "insufficient", description: "只有笼统结论，未覆盖核心内容和来源。", sample: "我记得这一节讲过这个概念。" },
      { id: `${stableScopedId(knowledge.id)}-anchor-developing-v1`, band: "developing", description: "覆盖部分核心内容，但解释或来源不完整。", sample: `[ref:${primaryRef}] ${terms[0]}` },
      { id: `${stableScopedId(knowledge.id)}-anchor-proficient-v1`, band: "proficient", description: "核心内容、关键细节和可核对来源相互支撑。", sample: `${allCitations} ${proficientPhrases.join("；")}`.slice(0, 1_600) },
    ],
    criteria,
  };
}

function validateQuestion(issues, question, item, expectedRefs, sourceText, questionIds, expectedContext) {
  const label = question?.id ?? "unknown";
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,159}$/.test(label) || questionIds.has(label)) {
    addIssue(issues, "invalid_authored_question_id", `教学问题标识无效或重复: ${label}`, "error");
  }
  questionIds.add(label);
  if (question?.knowledgeId !== item.knowledgeId || question?.context !== expectedContext
    || question?.kind !== "rubric_response" || question?.provenance !== "rule_extracted"
    || !Number.isSafeInteger(question?.difficulty) || question.difficulty < 1 || question.difficulty > 5
    || !boundedText(question?.prompt, 800) || INVALID_SOURCE_TEXT.test(question?.prompt ?? "")) {
    addIssue(issues, "invalid_authored_question", `教学问题 ${label} 的基本结构无效。`, "error");
  }
  if (question?.evidencePolicy !== "practice_only_until_runtime_validation") {
    addIssue(issues, "unsafe_authored_evidence_policy", `教学问题 ${label} 不得直接形成高置信度掌握证据。`, "error");
  }
  if (!sameSourceRefs(question?.sourceRefs, expectedRefs) || !sameStringSet(question?.requiredSourceRefs, expectedRefs.map((ref) => ref.sectionId))) {
    addIssue(issues, "authored_question_source_mismatch", `教学问题 ${label} 的来源约束无效。`, "error");
  }
  if (expectedRefs.some((ref) => !String(question?.prompt ?? "").includes(`[ref:${ref.sectionId}]`))) {
    addIssue(issues, "authored_question_citation_missing", `教学问题 ${label} 未提示所需来源标记。`, "error");
  }
  const answer = boundedText(question?.referenceAnswer, MAX_TEXT);
  if (!answer || INVALID_SOURCE_TEXT.test(answer) || !sourceText.includes(normalizeText(answer))) {
    addIssue(issues, "authored_reference_answer_not_grounded", `教学问题 ${label} 的参考答案未锚定原文。`, "error");
  }
  if (!validRubric(question?.rubric, expectedRefs.map((ref) => ref.sectionId), sourceText)) {
    addIssue(issues, "invalid_authored_rubric", `教学问题 ${label} 的评分量表无效。`, "error");
  }
}

function validRubric(rubric, sourceKeys, sourceText) {
  if (rubric?.profile !== "anchored-concept-rubric-v2" || rubric?.version !== "2.0.0") return false;
  if (!sameStringSet(rubric.requiredSourceRefs, sourceKeys) || !sameStringSet(rubric.availableSourceRefs, sourceKeys)) return false;
  if (!Array.isArray(rubric.criteria) || rubric.criteria.length < 3 || rubric.criteria.length > 12) return false;
  if (!Array.isArray(rubric.bands) || rubric.bands.length !== 3 || !rubric.bands.some((band) => band.id === rubric.passBand)) return false;
  if (!Array.isArray(rubric.anchors) || rubric.bands.some((band) => !rubric.anchors.some((anchor) =>
    anchor.band === band.id && boundedText(anchor.description, 500) && boundedText(anchor.sample, 1_600) && !INVALID_SOURCE_TEXT.test(anchor.sample)))) return false;
  if (rubric.anchors.filter((anchor) => anchor.band !== "insufficient").some((anchor) => {
    const answerText = normalizeText(anchor.sample).replace(/\[ref:[^\]]+\]\s*/g, "");
    const groundedParts = answerText.split(/[；;]/).map(normalizeText).filter(Boolean);
    return !sourceKeys.some((key) => anchor.sample.includes(`[ref:${key}]`))
      || !groundedParts.length
      || groundedParts.some((part) => !sourceText.includes(part));
  })) return false;
  const total = rubric.criteria.reduce((sum, criterion) => sum + Number(criterion.weight || 0), 0) + Number(rubric.sourceWeight || 0);
  return total > 0 && total <= 1.0001 && rubric.criteria.every((criterion) =>
    boundedText(criterion.label, 300)
    && Number(criterion.weight) > 0 && Number(criterion.weight) <= 1
    && sourceKeys.includes(criterion.sourceRef)
    && boundedStringArray(criterion.acceptedPhrases, 20, 100)
    && Array.isArray(criterion.partialPhrases) && criterion.partialPhrases.length <= 20
    && criterion.partialPhrases.every((phrase) => boundedText(phrase, 100)));
}

function sourceTerms(knowledge, referenceAnswer) {
  const source = normalizeText(referenceAnswer);
  const values = [knowledge.name, ...knowledge.learningObjectives, ...String(referenceAnswer).split(/[，。；;、\s]+/)]
    .map((value) => normalizeText(value))
    .filter((value) => value.length >= 2 && value.length <= 40 && /[\p{L}\p{N}]/u.test(value) && source.includes(value));
  const unique = [...new Set(values)];
  const fallback = unique[0] ?? source.slice(0, 40);
  while (unique.length < 10) unique.push(fallback);
  return unique.slice(0, 12);
}

function sameSourceRefs(left, right) {
  const normalize = (refs) => (Array.isArray(refs) ? refs : []).map((ref) =>
    `${ref?.sourceHash ?? ""}:${ref?.sectionId ?? ""}:${ref?.pageNumber ?? ""}:${ref?.origin ?? ""}:${normalizeText(ref?.excerpt)}`).sort();
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function sameStringSet(left, right) {
  const normalize = (values) => [...new Set(Array.isArray(values) ? values : [])].sort();
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function knowledgeSourceRefs(knowledge) {
  const refs = Array.isArray(knowledge?.sourceRefs) && knowledge.sourceRefs.length
    ? knowledge.sourceRefs
    : knowledge?.sourceRef ? [knowledge.sourceRef] : [];
  const seen = new Set();
  return refs.filter((ref) => {
    const key = `${ref?.sourceHash ?? ""}:${ref?.sectionId ?? ""}:${ref?.pageNumber ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function assertMapConfirmed(draft) {
  if (draft.status === "published") throw new Error("draft_already_published");
  if (!draft.confirmation || draft.confirmation.revision !== draft.revision) throw new Error("draft_confirmation_required");
}

function requireActiveContent(draft) {
  const content = activeAuthoredContentVersion(draft);
  if (!content) throw new Error("authored_content_not_generated");
  return content;
}

function authoredVersions(draft) {
  if (!Array.isArray(draft.authoredContentVersions)) draft.authoredContentVersions = [];
  return draft.authoredContentVersions;
}

function findDraft(state, draftId) {
  const draft = state.privateTutorKnowledgeMapDrafts.find((item) => item.id === draftId);
  if (!draft) throw new Error("draft_not_found");
  return draft;
}

function boundedObjectArray(value, max, code) {
  if (!Array.isArray(value) || value.length > max || value.some((item) => !item || typeof item !== "object" || Array.isArray(item))) throw new Error(code);
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_CONTENT_PAYLOAD_BYTES) throw new Error(code);
  return structuredClone(value);
}

function boundedStringArray(value, maxItems, maxTextLength) {
  return Array.isArray(value) && value.length > 0 && value.length <= maxItems
    && value.every((item) => boundedText(item, maxTextLength) && !INVALID_SOURCE_TEXT.test(item));
}

function boundedText(value, max) {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result && result.length <= max ? result : null;
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function sanitizeId(value) {
  return String(value ?? "content").replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 100);
}

function stableScopedId(value) {
  const raw = String(value ?? "content");
  return `${sanitizeId(raw).slice(0, 80)}-${createHash("sha256").update(raw).digest("hex").slice(0, 8)}`;
}

function addIssue(issues, type, message, severity) {
  if (!issues.some((issue) => issue.type === type && issue.message === message)) issues.push({ type, message, severity });
}
