import assert from "node:assert/strict";
import test from "node:test";
import {
  activeAuthoredContentVersion,
  authoredContentFingerprint,
  confirmAuthoredContentVersion,
  generateAuthoredContentVersion,
  updateAuthoredContentVersion,
  validateAuthoredContentVersion,
} from "../src/services/private-tutor-content-authoring.mjs";
import {
  confirmKnowledgeMapDraft,
  generateKnowledgeMapDraft,
  publishKnowledgeMapDraft,
  updateKnowledgeMapDraft,
} from "../src/services/private-tutor-graph-extractor.mjs";
import { parseMaterialDocument } from "../src/services/private-tutor-material-parser.mjs";
import { judgePrivateTutorAnswer } from "../src/services/private-tutor-assessment.mjs";

function fixture() {
  const material = parseMaterialDocument({
    learningProfileId: "learner_author",
    fileName: "learning.md",
    fileType: "markdown",
    fileContent: `# 第一章 学习证据
## 第一节 形成性反馈
### 核心概念
形成性反馈通过发现学习差距并及时调整下一步策略来改善学习。
- 目标: 解释形成性反馈如何改善学习。
### 应用方法
学习者应依据反馈定位差距、选择练习，并在下一次任务中检查改进结果。`,
  });
  const draft = generateKnowledgeMapDraft({
    materialDocument: material,
    packageName: "形成性反馈学习包",
    subjectId: "conceptual_studies",
    domain: "education",
  });
  const state = {
    privateTutorMaterialDocuments: [material],
    privateTutorKnowledgeMapDrafts: [draft],
    privateTutorContentPackages: [],
    privateTutorModules: [],
    privateTutorTopics: [],
    privateTutorKnowledgeComponents: [],
  };
  confirmKnowledgeMapDraft(state, draft.id, {
    actorId: "learner_author",
    expectedRevision: draft.revision,
    acknowledgeSourceReview: true,
  });
  return { material, draft, state };
}

test("authors complete source-grounded learning activities and anchored rubrics", () => {
  const { draft, state } = fixture();
  const content = generateAuthoredContentVersion(state, draft.id, {
    actorId: "learner_author",
    now: "2026-08-27T02:00:00.000Z",
  });

  assert.equal(content.version, 1);
  assert.equal(content.revision, 1);
  assert.equal(content.status, "in_review");
  assert.equal(content.knowledgeContents.length, draft.draftKnowledgeComponents.length);
  assert.deepEqual(content.validationIssues, []);
  assert.equal(draft.status, "content_in_review");
  assert.equal(draft.activeAuthoredContentVersion, 1);

  const item = content.knowledgeContents[0];
  assert.equal(item.teachingContent.provenance, "source_excerpt");
  assert.equal(item.teachingContent.guidanceProvenance, "rule_extracted");
  assert.equal(item.diagnosticQuestions.length, 1);
  assert.equal(item.tutoringQuestions.length, 3);
  assert.equal(item.dailyQuestions.length, 1);
  assert.equal(item.reviewQuestions.length, 1);
  const question = item.dailyQuestions[0];
  assert.equal(question.kind, "rubric_response");
  assert.equal(question.rubric.profile, "anchored-concept-rubric-v2");
  assert.equal(question.rubric.anchors.length, 3);
  assert.equal(question.evidencePolicy, "practice_only_until_runtime_validation");
  assert.match(question.prompt, /\[ref:sec_/);
  assert.equal(question.sourceRefs[0].sourceHash, draft.sourceSnapshot.sourceHash);
});

test("requires current authored-content confirmation before publishing a versioned package", () => {
  const { draft, state } = fixture();
  const content = generateAuthoredContentVersion(state, draft.id, { actorId: "learner_author" });
  assert.throws(() => publishKnowledgeMapDraft(state, draft.id), /authored_content_confirmation_required/);

  const confirmed = confirmAuthoredContentVersion(state, draft.id, {
    actorId: "learner_author",
    expectedRevision: content.revision,
    acknowledgeContentReview: true,
    now: "2026-08-27T02:01:00.000Z",
  });
  assert.equal(confirmed.confirmation.fingerprint, authoredContentFingerprint(confirmed));
  assert.equal(draft.status, "content_confirmed");

  const packageId = publishKnowledgeMapDraft(state, draft.id, "2026-08-27T02:02:00.000Z");
  const pkg = state.privateTutorContentPackages.find((item) => item.id === packageId);
  assert.equal(pkg.version, "1.0.0");
  assert.equal(pkg.status, "published");
  assert.match(pkg.contentChecksum, /^[a-f0-9]{64}$/);
  assert.equal(pkg.source.authoredContentVersion, 1);
  assert.equal(pkg.evaluationCapabilities.semanticEvaluation, "source_grounded_rubric");
  assert.equal(pkg.evaluationCapabilities.evidenceConfidenceCapped, true);
  assert.equal(pkg.knowledgeComponents.every((item) => item.teachingContent && item.dailyQuestions.length === 1), true);
  assert.equal(pkg.knowledgeComponents.every((item) => item.dailyQuestions[0].evidencePolicy === "practice_only_until_runtime_validation"), true);
  const practiceQuestion = pkg.knowledgeComponents[0].dailyQuestions[0];
  const evaluation = judgePrivateTutorAnswer(
    practiceQuestion.id,
    { rawAnswer: `[ref:${practiceQuestion.requiredSourceRefs[0]}] ${practiceQuestion.referenceAnswer}`, responseKind: "answer" },
    state,
    packageId,
  );
  assert.equal(evaluation.accepted, true);
  assert.equal(evaluation.evidenceEligible, false);
  assert.equal(evaluation.evidenceTier, "practice_only");
  assert.equal(evaluation.evaluation.evidencePolicy, "practice_only_until_runtime_validation");
  assert.equal(confirmed.status, "published");
});

test("content edits invalidate review and regeneration preserves immutable version history", () => {
  const { draft, state } = fixture();
  const first = generateAuthoredContentVersion(state, draft.id, { actorId: "learner_author" });
  confirmAuthoredContentVersion(state, draft.id, {
    actorId: "learner_author",
    expectedRevision: first.revision,
    acknowledgeContentReview: true,
  });

  const editedKnowledge = structuredClone(first.knowledgeContents);
  editedKnowledge[0].teachingContent.guidance = "先阅读原文，再说明核心概念。";
  const edited = updateAuthoredContentVersion(state, draft.id, { knowledgeContents: editedKnowledge });
  assert.equal(edited.revision, 2);
  assert.equal(edited.confirmation, null);
  assert.equal(edited.status, "in_review");
  assert.throws(() => publishKnowledgeMapDraft(state, draft.id), /authored_content_confirmation_required/);

  const second = generateAuthoredContentVersion(state, draft.id, {
    actorId: "learner_author",
    forceRegenerate: true,
  });
  assert.equal(second.version, 2);
  assert.equal(draft.authoredContentVersions.length, 2);
  assert.equal(draft.authoredContentVersions[0].status, "superseded");
  assert.equal(activeAuthoredContentVersion(draft).id, second.id);
});

test("blocks ungrounded explanations, answers, unsafe evidence, and invalid anchors", () => {
  const { draft, state } = fixture();
  const content = generateAuthoredContentVersion(state, draft.id, { actorId: "learner_author" });
  const tampered = structuredClone(content.knowledgeContents);
  const question = tampered[0].dailyQuestions[0];
  tampered[0].teachingContent.explanation = "这是原文中不存在的结论。";
  question.referenceAnswer = "这是原文中不存在的答案。";
  question.evidencePolicy = "high_confidence";
  question.rubric.anchors = [];
  const updated = updateAuthoredContentVersion(state, draft.id, { knowledgeContents: tampered });
  const issueTypes = new Set(validateAuthoredContentVersion(draft, updated).map((issue) => issue.type));
  assert.equal(issueTypes.has("authored_explanation_not_grounded"), true);
  assert.equal(issueTypes.has("authored_reference_answer_not_grounded"), true);
  assert.equal(issueTypes.has("unsafe_authored_evidence_policy"), true);
  assert.equal(issueTypes.has("invalid_authored_rubric"), true);
  assert.throws(() => confirmAuthoredContentVersion(state, draft.id, {
    actorId: "learner_author",
    expectedRevision: updated.revision,
    acknowledgeContentReview: true,
  }), /authored_content_has_validation_errors/);
});

test("editing the knowledge map supersedes its authored content and requires regeneration", () => {
  const { draft, state } = fixture();
  generateAuthoredContentVersion(state, draft.id, { actorId: "learner_author" });
  updateKnowledgeMapDraft(state, draft.id, { packageName: "调整后的学习包" });
  assert.equal(draft.activeAuthoredContentVersion, null);
  assert.equal(draft.authoredContentVersions[0].status, "superseded");
  assert.throws(() => generateAuthoredContentVersion(state, draft.id, { actorId: "learner_author" }), /draft_confirmation_required/);
});
