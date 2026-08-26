import { createHash } from "node:crypto";

export const DRAFT_SCHEMA_VERSION = 1;

/**
 * Extracts a draft Knowledge Map (Modules, Topics, KCs, Prerequisite edges)
 * from a parsed Material Document.
 */
export function generateKnowledgeMapDraft({
  materialDocument,
  packageName,
  subjectId = "general",
  domain = "general",
  now = new Date().toISOString(),
}) {
  if (!materialDocument || !Array.isArray(materialDocument.sections) || materialDocument.sections.length === 0) {
    throw new Error("invalid_material_document");
  }

  const draftId = `kmd_${createHash("sha256").update(materialDocument.sourceHash + packageName).digest("hex").slice(0, 16)}`;

  // We will map sections to modules/topics/kcs based on heading levels.
  // Level 1 -> Module, Level 2 -> Topic, Level 3+ -> KnowledgeComponent
  const draftModules = [];
  const draftTopics = [];
  const draftKnowledgeComponents = [];

  let currentModule = null;
  let currentTopic = null;

  for (const sec of materialDocument.sections) {
    if (sec.level === 1) {
      currentModule = {
        id: `mod_${sec.id}`,
        name: sec.title,
        description: sec.content.slice(0, 100) + (sec.content.length > 100 ? "..." : ""),
        sourceSectionId: sec.id,
        orderIndex: draftModules.length + 1,
      };
      draftModules.push(currentModule);
      currentTopic = null;
    } else if (sec.level === 2) {
      if (!currentModule) {
        // Promote to module if no parent module exists
        currentModule = {
          id: `mod_${sec.id}`,
          name: sec.title,
          description: sec.content.slice(0, 100) + (sec.content.length > 100 ? "..." : ""),
          sourceSectionId: sec.id,
          orderIndex: draftModules.length + 1,
        };
        draftModules.push(currentModule);
      } else {
        currentTopic = {
          id: `top_${sec.id}`,
          moduleId: currentModule.id,
          name: sec.title,
          description: sec.content.slice(0, 100) + (sec.content.length > 100 ? "..." : ""),
          sourceSectionId: sec.id,
          orderIndex: draftTopics.length + 1,
        };
        draftTopics.push(currentTopic);
      }
    } else {
      // Level 3 or deeper -> KnowledgeComponent
      let targetTopic = currentTopic;
      if (!targetTopic) {
        // Create an implicit topic if one doesn't exist
        if (!currentModule) {
          currentModule = {
            id: `mod_implicit_${draftModules.length + 1}`,
            name: "默认模块",
            description: "自动生成的父级模块",
            sourceSectionId: sec.id,
            orderIndex: draftModules.length + 1,
          };
          draftModules.push(currentModule);
        }
        targetTopic = {
          id: `top_implicit_${draftTopics.length + 1}`,
          moduleId: currentModule.id,
          name: "默认主题",
          description: "自动生成的父级主题",
          sourceSectionId: sec.id,
          orderIndex: draftTopics.length + 1,
        };
        draftTopics.push(targetTopic);
        currentTopic = targetTopic;
      }

      // Heuristic: extract learning objectives and questions from text
      const { objectives, questions } = extractObjectivesAndQuestions(sec.content);

      draftKnowledgeComponents.push({
        id: `kc_${sec.id}`,
        topicId: targetTopic.id,
        name: sec.title,
        shortDescription: sec.content.slice(0, 50) + (sec.content.length > 50 ? "..." : ""),
        learningObjectives: objectives,
        prerequisiteDraftIds: [], // Will be populated by inferPrerequisites
        sourceRef: {
          sectionId: sec.id,
          pageNumber: sec.pageNumber,
          excerpt: sec.content.slice(0, 200),
        },
        candidateQuestions: questions,
        orderIndex: draftKnowledgeComponents.length + 1,
      });
    }
  }

  // Infer prerequisites (simple sequential heuristic for now)
  for (let i = 1; i < draftKnowledgeComponents.length; i++) {
    const prevKc = draftKnowledgeComponents[i - 1];
    const currentKc = draftKnowledgeComponents[i];
    // If they are in the same topic or consecutive topics, assume sequential prerequisite
    currentKc.prerequisiteDraftIds.push(prevKc.id);
  }

  const validationIssues = validateDraft(draftKnowledgeComponents);

  return {
    id: draftId,
    materialDocumentId: materialDocument.id,
    learningProfileId: materialDocument.learningProfileId,
    packageName,
    subjectId,
    domain,
    schemaVersion: DRAFT_SCHEMA_VERSION,
    draftModules,
    draftTopics,
    draftKnowledgeComponents,
    validationIssues,
    status: "in_review",
    createdAt: now,
    updatedAt: now,
  };
}

function extractObjectivesAndQuestions(content) {
  const objectives = [];
  const questions = [];

  // Look for bullet points starting with objective markers
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("- 目标:") || trimmed.startsWith("* 目标:") || trimmed.toLowerCase().startsWith("objective:")) {
      objectives.push(trimmed.replace(/^[-*]\s*(目标|objective)[:：]\s*/i, "").trim());
    }
    if (trimmed.startsWith("- 问题:") || trimmed.startsWith("* 问题:") || trimmed.toLowerCase().startsWith("question:")) {
      questions.push({
        id: `q_${questions.length + 1}`,
        prompt: trimmed.replace(/^[-*]\s*(问题|question)[:：]\s*/i, "").trim(),
        kind: "open_ended",
      });
    }
  }

  if (objectives.length === 0) {
    objectives.push("掌握本节核心概念");
  }

  return { objectives, questions };
}

export function validateDraft(knowledgeComponents) {
  const issues = [];
  const kcMap = new Map(knowledgeComponents.map(kc => [kc.id, kc]));
  const visited = new Set();
  const recursionStack = new Set();

  function detectCycle(kcId) {
    if (recursionStack.has(kcId)) {
      issues.push({ type: "cycle", message: `检测到循环依赖: ${kcId}`, severity: "error" });
      return;
    }
    if (visited.has(kcId)) return;

    visited.add(kcId);
    recursionStack.add(kcId);

    const kc = kcMap.get(kcId);
    if (kc) {
      for (const prereqId of kc.prerequisiteDraftIds) {
        if (!kcMap.has(prereqId)) {
          issues.push({ type: "missing_prerequisite", message: `缺失前置知识点: ${prereqId}`, severity: "warning" });
        } else {
          detectCycle(prereqId);
        }
      }
    }

    recursionStack.delete(kcId);
  }

  for (const kc of knowledgeComponents) {
    if (!visited.has(kc.id)) {
      detectCycle(kc.id);
    }
  }

  return issues;
}

/**
 * Publishes a validated draft into a standard LearningContentPackage
 */
export function publishKnowledgeMapDraft(state, draftId, now = new Date().toISOString()) {
  const draftIndex = state.privateTutorKnowledgeMapDrafts.findIndex((d) => d.id === draftId);
  if (draftIndex === -1) throw new Error("draft_not_found");
  const draft = state.privateTutorKnowledgeMapDrafts[draftIndex];

  if (draft.status === "published") return draft.publishedPackageId;

  const errors = draft.validationIssues.filter((i) => i.severity === "error");
  if (errors.length > 0) throw new Error("draft_has_validation_errors");

  const packageId = `pkg-user-${draft.id.replace("kmd_", "")}`;

  // Convert draft to standard package format
  const pkg = {
    id: packageId,
    name: draft.packageName,
    subjectId: draft.subjectId,
    domain: draft.domain,
    sourceType: "user_material",
    version: "1.0.0",
    license: "user_private",
    targetAudience: {
      stage: "custom",
      description: "用户导入的自定义学习资料",
      prerequisites: [],
    },
    evaluationCapabilities: {
      deterministicGrading: false,
      semanticEvaluation: true,
      evidenceConfidenceCapped: true,
      stepEvaluation: false,
      speechEvaluation: false,
      visualInteractions: false,
    },
    modules: draft.draftModules.map(m => ({
      id: m.id,
      name: m.name,
      description: m.description,
      orderIndex: m.orderIndex,
      topics: draft.draftTopics.filter(t => t.moduleId === m.id).map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        orderIndex: t.orderIndex,
        knowledgeComponentIds: draft.draftKnowledgeComponents.filter(kc => kc.topicId === t.id).map(kc => kc.id)
      }))
    })),
    knowledgeComponents: draft.draftKnowledgeComponents.map(kc => ({
      id: kc.id,
      name: kc.name,
      shortDescription: kc.shortDescription,
      topicId: kc.topicId,
      orderIndex: kc.orderIndex,
      prerequisiteKnowledgeIds: kc.prerequisiteDraftIds, // Map draft prerequisites to standard format
      learningObjectives: kc.learningObjectives,
      questions: kc.candidateQuestions,
      misconceptions: [],
      downstreamImpact: 3,
      visualSceneId: null,
    })),
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
  };

  // Save to state
  state.privateTutorContentPackages.push(pkg);
  state.privateTutorModules.push(...pkg.modules.map(m => ({ ...m, packageId: pkg.id, createdAt: now })));
  state.privateTutorTopics.push(...pkg.modules.flatMap(m => m.topics.map(t => ({ ...t, packageId: pkg.id, moduleId: m.id, createdAt: now }))));
  state.privateTutorKnowledgeComponents.push(...pkg.knowledgeComponents.map(kc => ({ ...kc, packageId: pkg.id, createdAt: now })));

  // Update draft status
  draft.status = "published";
  draft.publishedPackageId = pkg.id;
  draft.updatedAt = now;
  state.privateTutorKnowledgeMapDrafts[draftIndex] = draft;

  return pkg.id;
}
