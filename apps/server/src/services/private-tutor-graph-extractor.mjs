import { createHash } from "node:crypto";
import { authoredContentFingerprint, requireConfirmedAuthoredContent } from "./private-tutor-content-authoring.mjs";

export const DRAFT_SCHEMA_VERSION = 2;

const MAX_MODULES = 100;
const MAX_TOPICS = 500;
const MAX_KNOWLEDGE_COMPONENTS = 2_000;
const INVALID_SOURCE_TEXT = /%PDF-|\bendstream\b|\bxref\b|\uFFFD{3,}/i;

export function generateKnowledgeMapDraft({
  materialDocument,
  packageName,
  subjectId = "general",
  domain = "general",
  now = new Date().toISOString(),
}) {
  if (materialDocument?.status !== "parsed"
    || !Array.isArray(materialDocument.sections)
    || materialDocument.sections.length === 0
    || INVALID_SOURCE_TEXT.test(materialDocument.sections.map((section) => section.content).join("\n"))) {
    throw new Error("invalid_material_document");
  }
  const normalizedPackageName = boundedRequiredString(packageName, 160, "invalid_package_name");
  const draftIdHash = createHash("sha256")
    .update(`${materialDocument.learningProfileId}\0${materialDocument.sourceHash}\0${normalizedPackageName}`)
    .digest("hex");
  const draftModules = [];
  const draftTopics = [];
  const draftKnowledgeComponents = [];
  let currentModule = null;
  let currentTopic = null;

  const addModule = (section, implicit = false) => {
    if (draftModules.length >= MAX_MODULES) return draftModules.at(-1) ?? null;
    const module = {
      id: `mod_${implicit ? "implicit_" : ""}${section.id}`,
      name: implicit ? "课程内容" : section.title,
      description: summary(section.content || section.title, 160),
      sourceSectionId: section.id,
      sourceRef: sourceRef(materialDocument, section),
      orderIndex: draftModules.length + 1,
    };
    draftModules.push(module);
    currentModule = module;
    return module;
  };
  const addTopic = (section, { implicit = false, name = null } = {}) => {
    if (!currentModule) addModule(section, true);
    if (!currentModule || draftTopics.length >= MAX_TOPICS) return draftTopics.at(-1) ?? null;
    const topic = {
      id: `top_${implicit ? "implicit_" : ""}${section.id}`,
      moduleId: currentModule.id,
      name: name ?? (implicit ? `${currentModule.name} · 核心内容` : section.title),
      description: summary(section.content || section.title, 160),
      sourceSectionId: section.id,
      sourceRef: sourceRef(materialDocument, section),
      orderIndex: draftTopics.length + 1,
    };
    draftTopics.push(topic);
    currentTopic = topic;
    return topic;
  };
  const addKnowledge = (section) => {
    if (draftKnowledgeComponents.length >= MAX_KNOWLEDGE_COMPONENTS) return null;
    if (!currentModule) addModule(section, true);
    if (!currentTopic) addTopic(section, { implicit: true });
    if (!currentTopic) return null;
    const content = String(section.content ?? "").trim();
    if (!content && Number(section.level) < 3) return null;
    const { objectives, questions } = extractObjectivesAndQuestions(content);
    const ref = sourceRef(materialDocument, section);
    const knowledge = {
      id: `kc_${section.id}`,
      topicId: currentTopic.id,
      name: boundedRequiredString(section.title, 200, "invalid_source_section"),
      shortDescription: summary(content || section.title, 160),
      learningObjectives: objectives,
      prerequisiteDraftIds: [],
      sourceRef: ref,
      sourceRefs: [ref],
      candidateQuestions: questions,
      orderIndex: draftKnowledgeComponents.length + 1,
    };
    const previous = [...draftKnowledgeComponents].reverse().find((item) => item.topicId === knowledge.topicId);
    if (previous) knowledge.prerequisiteDraftIds.push(previous.id);
    draftKnowledgeComponents.push(knowledge);
    return knowledge;
  };

  for (const section of materialDocument.sections) {
    const level = Math.max(1, Number(section.level) || 1);
    if (level === 1) {
      addModule(section);
      currentTopic = null;
      if (String(section.content ?? "").trim()) {
        addTopic(section, { implicit: true, name: `${section.title} · 核心内容` });
        addKnowledge(section);
      }
    } else if (level === 2) {
      if (!currentModule) addModule(section, true);
      addTopic(section);
      addKnowledge(section);
    } else {
      if (!currentModule) addModule(section, true);
      if (!currentTopic) addTopic(section, { implicit: true });
      addKnowledge(section);
    }
  }

  const usedTopicIds = new Set(draftKnowledgeComponents.map((item) => item.topicId));
  const groundedTopics = draftTopics.filter((topic) => usedTopicIds.has(topic.id));
  const usedModuleIds = new Set(groundedTopics.map((topic) => topic.moduleId));
  const groundedModules = draftModules.filter((module) => usedModuleIds.has(module.id));
  groundedModules.forEach((module, index) => { module.orderIndex = index + 1; });
  groundedTopics.forEach((topic, index) => { topic.orderIndex = index + 1; });
  draftKnowledgeComponents.forEach((knowledge, index) => { knowledge.orderIndex = index + 1; });

  const sourceSnapshot = {
    materialDocumentId: materialDocument.id,
    sourceHash: materialDocument.sourceHash,
    parserVersion: materialDocument.extraction?.parserVersion ?? null,
    sectionCount: materialDocument.sections.length,
    pageCount: materialDocument.extraction?.pageCount ?? null,
  };
  const draft = {
    id: `kmd_${draftIdHash.slice(0, 16)}`,
    materialDocumentId: materialDocument.id,
    learningProfileId: materialDocument.learningProfileId,
    packageName: normalizedPackageName,
    subjectId: boundedRequiredString(subjectId, 100, "invalid_subject_id"),
    domain: boundedRequiredString(domain, 100, "invalid_domain"),
    schemaVersion: DRAFT_SCHEMA_VERSION,
    revision: 1,
    sourceSnapshot,
    draftModules: groundedModules,
    draftTopics: groundedTopics,
    draftKnowledgeComponents,
    validationIssues: [],
    confirmation: null,
    authoredContentVersions: [],
    activeAuthoredContentVersion: null,
    status: "in_review",
    createdAt: now,
    updatedAt: now,
  };
  draft.validationIssues = validateDraft(draftKnowledgeComponents, {
    modules: groundedModules,
    topics: groundedTopics,
    materialDocument,
    sourceSnapshot,
  });
  return draft;
}

export function updateKnowledgeMapDraft(state, draftId, patch, now = new Date().toISOString()) {
  const draft = findDraft(state, draftId);
  if (draft.status === "published") throw new Error("cannot_edit_published_draft");
  const materialDocument = findDraftMaterial(state, draft);
  if (patch.packageName != null) draft.packageName = boundedRequiredString(patch.packageName, 160, "invalid_package_name");
  if (patch.subjectId != null) draft.subjectId = boundedRequiredString(patch.subjectId, 100, "invalid_subject_id");
  if (patch.domain != null) draft.domain = boundedRequiredString(patch.domain, 100, "invalid_domain");
  if (patch.draftModules != null) draft.draftModules = boundedObjectArray(patch.draftModules, MAX_MODULES, "invalid_draft_modules");
  if (patch.draftTopics != null) draft.draftTopics = boundedObjectArray(patch.draftTopics, MAX_TOPICS, "invalid_draft_topics");
  if (patch.draftKnowledgeComponents != null) {
    draft.draftKnowledgeComponents = boundedObjectArray(
      patch.draftKnowledgeComponents,
      MAX_KNOWLEDGE_COMPONENTS,
      "invalid_draft_knowledge_components",
    );
  }
  draft.revision = Math.max(1, Number(draft.revision) || 1) + 1;
  draft.confirmation = null;
  for (const content of draft.authoredContentVersions ?? []) {
    if (content.status !== "published") content.status = "superseded";
  }
  draft.activeAuthoredContentVersion = null;
  draft.status = "in_review";
  draft.updatedAt = now;
  draft.validationIssues = validateDraft(draft.draftKnowledgeComponents, {
    modules: draft.draftModules,
    topics: draft.draftTopics,
    materialDocument,
    sourceSnapshot: draft.sourceSnapshot,
  });
  return draft;
}

export function confirmKnowledgeMapDraft(state, draftId, {
  actorId,
  expectedRevision,
  acknowledgeSourceReview,
  now = new Date().toISOString(),
} = {}) {
  const draft = findDraft(state, draftId);
  if (draft.status === "published") throw new Error("draft_already_published");
  if (!actorId || acknowledgeSourceReview !== true) throw new Error("draft_source_review_acknowledgement_required");
  if (!Number.isSafeInteger(Number(expectedRevision)) || Number(expectedRevision) !== draft.revision) {
    throw new Error("draft_revision_conflict");
  }
  const materialDocument = findDraftMaterial(state, draft);
  draft.validationIssues = validateDraft(draft.draftKnowledgeComponents, {
    modules: draft.draftModules,
    topics: draft.draftTopics,
    materialDocument,
    sourceSnapshot: draft.sourceSnapshot,
  });
  if (draft.validationIssues.some((issue) => issue.severity === "error")) {
    throw new Error("draft_has_validation_errors");
  }
  const fingerprint = knowledgeMapDraftFingerprint(draft);
  draft.confirmation = {
    revision: draft.revision,
    fingerprint,
    confirmedBy: actorId,
    confirmedAt: now,
    acknowledgement: "source_map_reviewed",
  };
  draft.status = "confirmed";
  draft.updatedAt = now;
  return draft;
}

export function validateDraft(knowledgeComponents, {
  modules = null,
  topics = null,
  materialDocument = null,
  sourceSnapshot = null,
} = {}) {
  const issues = [];
  const knowledge = Array.isArray(knowledgeComponents) ? knowledgeComponents : [];
  if (knowledge.length === 0) addIssue(issues, "empty_knowledge_map", "知识地图至少需要一个知识点。", "error");
  if (knowledge.length > MAX_KNOWLEDGE_COMPONENTS) addIssue(issues, "knowledge_map_too_large", "知识点数量超过上限。", "error");

  const moduleList = Array.isArray(modules) ? modules : null;
  const topicList = Array.isArray(topics) ? topics : null;
  const moduleIds = new Set();
  const topicIds = new Set();
  if (moduleList && moduleList.length === 0) addIssue(issues, "empty_module_map", "知识地图至少需要一个模块。", "error");
  if (topicList && topicList.length === 0) addIssue(issues, "empty_topic_map", "知识地图至少需要一个主题。", "error");
  if (moduleList && moduleList.length > MAX_MODULES) addIssue(issues, "module_map_too_large", "模块数量超过上限。", "error");
  if (topicList && topicList.length > MAX_TOPICS) addIssue(issues, "topic_map_too_large", "主题数量超过上限。", "error");
  const moduleOrderIndexes = new Set();
  for (const module of moduleList ?? []) {
    if (!validDraftId(module?.id)) {
      addIssue(issues, "invalid_module_id", "模块标识无效。", "error");
    } else if (moduleIds.has(module.id)) {
      addIssue(issues, "duplicate_module_id", `模块标识重复: ${module.id}`, "error");
    } else {
      moduleIds.add(module.id);
    }
    if (!boundedText(module?.name, 200)) addIssue(issues, "missing_module_name", `模块 ${module?.id ?? "unknown"} 缺少名称。`, "error");
    if (!Number.isSafeInteger(module?.orderIndex) || module.orderIndex < 1 || moduleOrderIndexes.has(module.orderIndex)) {
      addIssue(issues, "invalid_module_order", `模块 ${module?.id ?? "unknown"} 的顺序无效。`, "error");
    }
    moduleOrderIndexes.add(module?.orderIndex);
  }
  const topicOrderIndexes = new Set();
  for (const topic of topicList ?? []) {
    if (!validDraftId(topic?.id)) {
      addIssue(issues, "invalid_topic_id", "主题标识无效。", "error");
    } else if (topicIds.has(topic.id)) {
      addIssue(issues, "duplicate_topic_id", `主题标识重复: ${topic.id}`, "error");
    } else {
      topicIds.add(topic.id);
    }
    if (!boundedText(topic?.name, 200)) addIssue(issues, "missing_topic_name", `主题 ${topic?.id ?? "unknown"} 缺少名称。`, "error");
    if (!moduleIds.has(topic?.moduleId)) addIssue(issues, "orphan_topic", `主题 ${topic?.id ?? "unknown"} 没有所属模块。`, "error");
    if (!Number.isSafeInteger(topic?.orderIndex) || topic.orderIndex < 1 || topicOrderIndexes.has(topic.orderIndex)) {
      addIssue(issues, "invalid_topic_order", `主题 ${topic?.id ?? "unknown"} 的顺序无效。`, "error");
    }
    topicOrderIndexes.add(topic?.orderIndex);
  }

  const sectionMap = new Map((materialDocument?.sections ?? []).map((section) => [section.id, section]));
  if (materialDocument) {
    if (materialDocument.status !== "parsed") addIssue(issues, "material_not_parsed", "来源资料尚未完成解析。", "error");
    if (!sourceSnapshot || sourceSnapshot.sourceHash !== materialDocument.sourceHash) {
      addIssue(issues, "source_snapshot_changed", "来源资料已变化，需要重新生成知识地图。", "error");
    }
  }

  const kcMap = new Map();
  const groundedSectionIds = new Set();
  const orderIndexes = new Set();
  for (const module of moduleList ?? []) {
    validateSourceReference(issues, module, [module?.sourceRef].filter(Boolean), materialDocument, sectionMap, groundedSectionIds);
  }
  for (const topic of topicList ?? []) {
    validateSourceReference(issues, topic, [topic?.sourceRef].filter(Boolean), materialDocument, sectionMap, groundedSectionIds);
  }
  for (const item of knowledge) {
    if (!item || typeof item !== "object" || !validDraftId(item.id)) {
      addIssue(issues, "invalid_knowledge_id", "知识点标识无效。", "error");
      continue;
    }
    if (kcMap.has(item.id)) addIssue(issues, "duplicate_knowledge_id", `知识点标识重复: ${item.id}`, "error");
    kcMap.set(item.id, item);
    if (!boundedText(item.name, 200)) addIssue(issues, "missing_knowledge_name", `知识点 ${item.id} 缺少名称。`, "error");
    if (topicList && !topicIds.has(item.topicId)) addIssue(issues, "orphan_knowledge", `知识点 ${item.id} 没有所属主题。`, "error");
    if (!Array.isArray(item.learningObjectives) || item.learningObjectives.length === 0
      || item.learningObjectives.some((objective) => !boundedText(objective, 500))) {
      addIssue(issues, "missing_learning_objective", `知识点 ${item.id} 缺少有效学习目标。`, "error");
    }
    if (!Array.isArray(item.prerequisiteDraftIds)
      || item.prerequisiteDraftIds.some((id) => !validDraftId(id))
      || new Set(item.prerequisiteDraftIds).size !== item.prerequisiteDraftIds.length) {
      addIssue(issues, "invalid_prerequisites", `知识点 ${item.id} 的前置关系无效。`, "error");
    }
    if (!Number.isSafeInteger(item.orderIndex) || item.orderIndex < 1 || orderIndexes.has(item.orderIndex)) {
      addIssue(issues, "invalid_knowledge_order", `知识点 ${item.id} 的顺序无效。`, "error");
    }
    orderIndexes.add(item.orderIndex);
    if (INVALID_SOURCE_TEXT.test(`${item.name ?? ""}\n${item.shortDescription ?? ""}`)) {
      addIssue(issues, "binary_text_detected", `知识点 ${item.id} 含有 PDF 二进制文本。`, "error");
    }
    validateSourceReference(issues, item, knowledgeSourceRefs(item), materialDocument, sectionMap, groundedSectionIds);
  }

  const visited = new Set();
  const recursionStack = new Set();
  function detectCycle(kcId) {
    if (recursionStack.has(kcId)) {
      addIssue(issues, "cycle", `检测到循环依赖: ${kcId}`, "error");
      return;
    }
    if (visited.has(kcId)) return;
    visited.add(kcId);
    recursionStack.add(kcId);
    const item = kcMap.get(kcId);
    for (const prerequisiteId of Array.isArray(item?.prerequisiteDraftIds) ? new Set(item.prerequisiteDraftIds) : []) {
      if (!kcMap.has(prerequisiteId)) {
        addIssue(issues, "missing_prerequisite", `缺失前置知识点: ${prerequisiteId}`, "error");
      } else {
        detectCycle(prerequisiteId);
      }
    }
    recursionStack.delete(kcId);
  }
  for (const item of knowledge) if (item?.id && !visited.has(item.id)) detectCycle(item.id);

  if (materialDocument) {
    const groundable = materialDocument.sections.filter((section) => String(section.content ?? "").trim()).length;
    if (groundable > groundedSectionIds.size) {
      addIssue(
        issues,
        "partial_source_coverage",
        `当前知识地图引用了 ${groundedSectionIds.size}/${groundable} 个含正文的来源章节。`,
        "warning",
      );
    }
  }
  return issues;
}

export function publishKnowledgeMapDraft(state, draftId, now = new Date().toISOString()) {
  const draft = findDraft(state, draftId);
  if (draft.status === "published") return draft.publishedPackageId;
  const materialDocument = findDraftMaterial(state, draft);
  draft.validationIssues = validateDraft(draft.draftKnowledgeComponents, {
    modules: draft.draftModules,
    topics: draft.draftTopics,
    materialDocument,
    sourceSnapshot: draft.sourceSnapshot,
  });
  if (draft.validationIssues.some((issue) => issue.severity === "error")) throw new Error("draft_has_validation_errors");
  const fingerprint = knowledgeMapDraftFingerprint(draft);
  if (draft.confirmation?.revision !== draft.revision
    || draft.confirmation?.fingerprint !== fingerprint) {
    throw new Error("draft_confirmation_required");
  }
  const authoredContent = requireConfirmedAuthoredContent(draft);
  const authoredByKnowledge = new Map(authoredContent.knowledgeContents.map((item) => [item.knowledgeId, item]));

  const packageId = `pkg-user-${draft.id.replace("kmd_", "")}`;
  const pkg = {
    id: packageId,
    name: draft.packageName,
    learningProfileId: draft.learningProfileId,
    subjectId: draft.subjectId,
    evaluationSubjectId: "conceptual_studies",
    domain: draft.domain,
    sourceType: "user_material",
    version: `${authoredContent.version}.0.0`,
    license: "user_private",
    source: {
      materialDocumentId: draft.materialDocumentId,
      sourceHash: draft.sourceSnapshot.sourceHash,
      parserVersion: draft.sourceSnapshot.parserVersion,
      mapFingerprint: fingerprint,
      confirmedAt: draft.confirmation.confirmedAt,
      authoredContentVersion: authoredContent.version,
      authoredContentRevision: authoredContent.revision,
      authoredContentFingerprint: authoredContentFingerprint(authoredContent),
      authoredContentConfirmedAt: authoredContent.confirmation.confirmedAt,
      generatorVersion: authoredContent.generatorVersion,
    },
    targetAudience: { stage: "custom", description: "用户导入并确认的自定义学习资料", prerequisites: [] },
    evaluationCapabilities: {
      deterministicGrading: false,
      semanticEvaluation: "source_grounded_rubric",
      evidenceConfidenceCapped: true,
      sourceGrounding: true,
      stepEvaluation: false,
      speechEvaluation: false,
      visualInteractions: false,
    },
    modules: draft.draftModules.map((module) => ({
      id: module.id,
      name: module.name,
      description: module.description,
      sourceRef: module.sourceRef ?? null,
      orderIndex: module.orderIndex,
      topics: draft.draftTopics.filter((topic) => topic.moduleId === module.id).map((topic) => ({
        id: topic.id,
        name: topic.name,
        description: topic.description,
        sourceRef: topic.sourceRef ?? null,
        orderIndex: topic.orderIndex,
        knowledgeComponentIds: draft.draftKnowledgeComponents
          .filter((knowledge) => knowledge.topicId === topic.id)
          .map((knowledge) => knowledge.id),
      })),
    })),
    knowledgeComponents: draft.draftKnowledgeComponents.map((knowledge) => {
      const authored = authoredByKnowledge.get(knowledge.id);
      return {
        id: knowledge.id,
        name: knowledge.name,
        shortDescription: knowledge.shortDescription,
        topicId: knowledge.topicId,
        orderIndex: knowledge.orderIndex,
        prerequisiteKnowledgeIds: knowledge.prerequisiteDraftIds,
        learningObjectives: knowledge.learningObjectives,
        sourceRefs: knowledgeSourceRefs(knowledge),
        sourceGrounding: "user_confirmed",
        teachingContent: authored.teachingContent,
        diagnosticQuestions: authored.diagnosticQuestions,
        tutoringQuestions: authored.tutoringQuestions,
        dailyQuestions: authored.dailyQuestions,
        reviewQuestions: authored.reviewQuestions,
        contentVersion: authoredContent.version,
        contentReview: structuredClone(authoredContent.confirmation),
        misconceptions: [],
        downstreamImpact: 3,
        visualSceneId: null,
      };
    }),
    schemaVersion: 1,
    status: "published",
    releasedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  pkg.contentChecksum = createHash("sha256").update(JSON.stringify({
    name: pkg.name,
    subjectId: pkg.subjectId,
    domain: pkg.domain,
    version: pkg.version,
    source: pkg.source,
    modules: pkg.modules,
    knowledgeComponents: pkg.knowledgeComponents,
  })).digest("hex");

  state.privateTutorContentPackages.push(pkg);
  state.privateTutorModules.push(...pkg.modules.map((module) => ({ ...module, packageId: pkg.id, createdAt: now })));
  state.privateTutorTopics.push(...pkg.modules.flatMap((module) =>
    module.topics.map((topic) => ({ ...topic, packageId: pkg.id, moduleId: module.id, createdAt: now }))));
  state.privateTutorKnowledgeComponents.push(...pkg.knowledgeComponents.map((knowledge) => ({
    ...knowledge,
    packageId: pkg.id,
    createdAt: now,
  })));
  draft.status = "published";
  draft.publishedPackageId = pkg.id;
  draft.updatedAt = now;
  authoredContent.status = "published";
  authoredContent.publishedAt = now;
  return pkg.id;
}

export function knowledgeMapDraftFingerprint(draft) {
  return createHash("sha256").update(JSON.stringify({
    schemaVersion: draft.schemaVersion,
    revision: draft.revision,
    packageName: draft.packageName,
    subjectId: draft.subjectId,
    domain: draft.domain,
    sourceSnapshot: draft.sourceSnapshot,
    modules: draft.draftModules,
    topics: draft.draftTopics,
    knowledgeComponents: draft.draftKnowledgeComponents,
  })).digest("hex");
}

function extractObjectivesAndQuestions(content) {
  const objectives = [];
  const questions = [];
  for (const line of String(content ?? "").split("\n")) {
    const trimmed = line.trim();
    if (/^[-*]\s*(目标|objective)[:：]/i.test(trimmed)) {
      objectives.push(trimmed.replace(/^[-*]\s*(目标|objective)[:：]\s*/i, "").trim());
    }
    if (/^[-*]\s*(问题|question)[:：]/i.test(trimmed)) {
      questions.push({
        id: `q_${questions.length + 1}`,
        prompt: trimmed.replace(/^[-*]\s*(问题|question)[:：]\s*/i, "").trim(),
        kind: "open_ended",
      });
    }
  }
  if (objectives.length === 0) objectives.push("理解并能够解释本节核心概念");
  return { objectives, questions };
}

function sourceRef(materialDocument, section) {
  return {
    sourceHash: materialDocument.sourceHash,
    sectionId: section.id,
    pageNumber: section.pageNumber ?? null,
    excerpt: summary(section.content || section.title, 240),
    origin: "source",
  };
}

function knowledgeSourceRefs(knowledge) {
  const refs = Array.isArray(knowledge?.sourceRefs) && knowledge.sourceRefs.length > 0
    ? knowledge.sourceRefs
    : knowledge?.sourceRef
      ? [knowledge.sourceRef]
      : [];
  const seen = new Set();
  return refs.filter((ref) => {
    const key = `${ref?.sourceHash ?? ""}:${ref?.sectionId ?? ""}:${ref?.pageNumber ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function validateSourceReference(issues, entity, refs, materialDocument, sectionMap, groundedSectionIds) {
  if (!materialDocument) return;
  const label = entity?.id ?? "unknown";
  if (refs.length === 0) {
    addIssue(issues, "missing_source_reference", `${label} 缺少来源引用。`, "error");
    return;
  }
  for (const ref of refs) {
    const section = sectionMap.get(ref?.sectionId);
    if (!section || ref?.sourceHash !== materialDocument.sourceHash || ref?.origin !== "source") {
      addIssue(issues, "unknown_source_reference", `${label} 的来源引用无效。`, "error");
      continue;
    }
    groundedSectionIds.add(section.id);
    if (!boundedText(ref.excerpt, 500)
      || INVALID_SOURCE_TEXT.test(ref.excerpt)
      || !sourceExcerptMatches(ref.excerpt, section)) {
      addIssue(issues, "invalid_source_excerpt", `${label} 的来源摘录无效。`, "error");
    }
    if (section.pageNumber != null && Number(ref.pageNumber) !== Number(section.pageNumber)) {
      addIssue(issues, "source_page_mismatch", `${label} 的来源页码不匹配。`, "error");
    }
  }
}

function sourceExcerptMatches(excerpt, section) {
  const normalizedExcerpt = String(excerpt ?? "").replace(/\s+/g, " ").trim().replace(/…$/, "");
  const normalizedSource = String(section?.content || section?.title || "").replace(/\s+/g, " ").trim();
  return normalizedExcerpt.length > 0 && normalizedSource.includes(normalizedExcerpt);
}

function findDraft(state, draftId) {
  const draft = state.privateTutorKnowledgeMapDrafts.find((item) => item.id === draftId);
  if (!draft) throw new Error("draft_not_found");
  return draft;
}

function findDraftMaterial(state, draft) {
  const material = state.privateTutorMaterialDocuments.find((item) =>
    item.id === draft.materialDocumentId && item.learningProfileId === draft.learningProfileId);
  if (!material) throw new Error("draft_material_not_found");
  return material;
}

function boundedObjectArray(value, max, code) {
  if (!Array.isArray(value) || value.length > max || value.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    throw new Error(code);
  }
  return structuredClone(value);
}

function boundedRequiredString(value, max, code) {
  const result = boundedText(value, max);
  if (!result) throw new Error(code);
  return result;
}

function boundedText(value, max) {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result && result.length <= max ? result : null;
}

function validDraftId(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{2,119}$/.test(value);
}

function summary(value, max) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function addIssue(issues, type, message, severity) {
  if (!issues.some((issue) => issue.type === type && issue.message === message)) issues.push({ type, message, severity });
}
