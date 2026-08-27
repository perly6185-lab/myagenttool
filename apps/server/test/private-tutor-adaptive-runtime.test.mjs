import assert from "node:assert/strict";
import test from "node:test";
import {
  activatePrivateTutorPackageRuntime,
  deactivateMaterialDerivedLearning,
  privateTutorRuntimeValidation,
  validatePrivateTutorPackageRuntime,
} from "../src/services/private-tutor-adaptive-runtime.mjs";
import { judgePrivateTutorAnswer, privateTutorDiagnosticConfig } from "../src/services/private-tutor-assessment.mjs";
import {
  confirmAuthoredContentVersion,
  generateAuthoredContentVersion,
} from "../src/services/private-tutor-content-authoring.mjs";
import {
  confirmKnowledgeMapDraft,
  generateKnowledgeMapDraft,
  publishKnowledgeMapDraft,
} from "../src/services/private-tutor-graph-extractor.mjs";
import { parseMaterialDocument } from "../src/services/private-tutor-material-parser.mjs";
import {
  completePrivateTutorActivity,
  completePrivateTutorPlanDay,
  createPrivateTutorSession,
  privateTutorSessionView,
  recordPrivateTutorSessionAnswer,
} from "../src/services/private-tutor-session.mjs";

function fixture() {
  let id = 0;
  let tick = 0;
  const nextId = (prefix) => `${prefix}_${++id}`;
  const now = () => new Date(Date.UTC(2026, 7, 27 + tick++, 8)).toISOString();
  const material = parseMaterialDocument({
    learningProfileId: "usr_runtime",
    fileName: "feedback.md",
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
    packageName: "形成性反馈",
    subjectId: "general",
    domain: "education",
  });
  const learner = {
    id: "learner_runtime",
    ownerTeamId: "team_runtime",
    createdBy: "usr_runtime",
    activePackageId: null,
    status: "active",
  };
  const state = {
    privateTutorMaterialDocuments: [material],
    privateTutorKnowledgeMapDrafts: [draft],
    privateTutorContentPackages: [],
    privateTutorModules: [],
    privateTutorTopics: [],
    privateTutorKnowledgeComponents: [],
    privateTutorSubjectPlugins: [],
    privateTutorRuntimeValidations: [],
    privateTutorPackageActivations: [],
    privateTutorLearnerModels: [],
    privateTutorStrategyDecisions: [],
    privateTutorLearningPlans: [],
    privateTutorSessions: [],
    privateTutorSnapshots: [{
      id: "snapshot_runtime",
      learnerId: learner.id,
      revision: 1,
      knowledge: [],
    }],
  };
  confirmKnowledgeMapDraft(state, draft.id, {
    actorId: "usr_runtime",
    expectedRevision: draft.revision,
    acknowledgeSourceReview: true,
  });
  const content = generateAuthoredContentVersion(state, draft.id, { actorId: "usr_runtime" });
  confirmAuthoredContentVersion(state, draft.id, {
    actorId: "usr_runtime",
    expectedRevision: content.revision,
    acknowledgeContentReview: true,
  });
  const packageId = publishKnowledgeMapDraft(state, draft.id, now());
  const pkg = state.privateTutorContentPackages.find((item) => item.id === packageId);
  learner.activePackageId = packageId;
  state.privateTutorSnapshots[0].contentPackageId = packageId;
  state.privateTutorSnapshots[0].contentPackageVersion = pkg.version;
  state.privateTutorSnapshots[0].knowledge = pkg.knowledgeComponents.map((item) => ({ id: item.id, mastery: null, level: "unknown", evidenceCount: 0 }));
  return { state, material, draft, learner, pkg, now, nextId };
}

test("calibrates every authored question twice before releasing capped runtime evidence", () => {
  const { state, learner, pkg, now, nextId } = fixture();
  const validation = validatePrivateTutorPackageRuntime(state, pkg.id, {
    actorId: "usr_runtime",
    learnerId: learner.id,
    now: now(),
    nextId,
  });
  assert.equal(validation.status, "passed");
  assert.equal(validation.questions.length, pkg.knowledgeComponents.length * 6);
  assert.equal(validation.questions.every((item) => item.anchors.length === 3 && item.anchors.every((anchor) => anchor.repeatable && anchor.passed)), true);
  assert.equal(privateTutorDiagnosticConfig(state, pkg.id)?.minQuestions, pkg.knowledgeComponents.length);

  const question = pkg.knowledgeComponents[0].diagnosticQuestions[0];
  const proficient = question.rubric.anchors.find((item) => item.band === "proficient").sample;
  const judgement = judgePrivateTutorAnswer(question.id, { rawAnswer: proficient, responseKind: "answer" }, state, pkg.id);
  assert.equal(judgement.accepted, true);
  assert.equal(judgement.correct, true);
  assert.equal(judgement.evidenceEligible, true);
  assert.equal(judgement.evidenceTier, "rubric_runtime_validated");
  assert.equal(judgement.evaluation.confidence, 0.85);
  assert.equal(judgement.evaluation.confidenceCapped, true);
  assert.equal(judgement.evaluation.runtimeValidationId, validation.id);
});

test("blocks activation when a score anchor no longer matches its declared band", () => {
  const { state, learner, pkg, now, nextId } = fixture();
  pkg.knowledgeComponents[0].diagnosticQuestions[0].rubric.anchors.find((item) => item.band === "proficient").sample = "我大概记得。";
  const validation = validatePrivateTutorPackageRuntime(state, pkg.id, {
    actorId: "usr_runtime",
    learnerId: learner.id,
    now: now(),
    nextId,
  });
  assert.equal(validation.status, "blocked");
  assert.equal(validation.failureCodes.includes("runtime_anchor_calibration_failed"), true);
  assert.throws(() => activatePrivateTutorPackageRuntime(state, {
    learner,
    pkg,
    actorId: "usr_runtime",
    entryMode: "diagnostic",
    now,
    nextId,
  }), /private_tutor_runtime_validation_failed/);
});

test("chapter entry creates a seven-day plan without inventing mastery and advances plan days", () => {
  const { state, learner, pkg, now, nextId } = fixture();
  const topic = pkg.modules[0].topics[0];
  const runtime = activatePrivateTutorPackageRuntime(state, {
    learner,
    pkg,
    actorId: "usr_runtime",
    entryMode: "chapter",
    startTopicId: topic.id,
    now,
    nextId,
  });
  assert.equal(runtime.activation.entryMode, "chapter");
  assert.equal(runtime.learningPlan.days.length, 7);
  assert.equal(runtime.learnerModel.knowledge.every((item) => item.mastery === null && item.evidenceCount === 0), true);
  assert.equal(runtime.strategyDecision.reasonCode, "user_selected_chapter");

  const session = createPrivateTutorSession({
    id: "session_runtime",
    ownerTeamId: learner.ownerTeamId,
    learnerId: learner.id,
    plan: runtime.learningPlan,
    decision: runtime.strategyDecision,
    pace: "easy",
    now,
    state,
    contentPackageId: pkg.id,
  });
  assert.equal(session.planDayIndex, 1);
  assert.equal(runtime.learningPlan.days[0].status, "in_progress");
  assert.equal(privateTutorSessionView(session, state).currentActivity.question.kind, "rubric_response");
  recordPrivateTutorSessionAnswer(session, { correct: true, attemptId: "practice_only", evidenceEligible: false, now });
  completePrivateTutorActivity(session, now);
  recordPrivateTutorSessionAnswer(session, { correct: true, attemptId: "evidence", evidenceEligible: true, now });
  completePrivateTutorActivity(session, now);
  completePrivateTutorActivity(session, now);
  assert.equal(session.status, "completed");
  assert.equal(session.summary.practiceCount, 2);
  assert.equal(session.summary.evidenceCount, 1);
  assert.equal(completePrivateTutorPlanDay(runtime.learningPlan, session, now()), true);
  assert.equal(runtime.learningPlan.days[0].status, "completed");
});

test("deleting source material revokes calibration and freezes derived learning objects", () => {
  const { state, material, learner, pkg, now, nextId } = fixture();
  const runtime = activatePrivateTutorPackageRuntime(state, {
    learner,
    pkg,
    actorId: "usr_runtime",
    entryMode: "chapter",
    startModuleId: pkg.modules[0].id,
    now,
    nextId,
  });
  state.privateTutorSessions.push({
    id: "session_to_freeze",
    learnerId: learner.id,
    contentPackageId: pkg.id,
    status: "paused",
    revision: 2,
  });
  const result = deactivateMaterialDerivedLearning(state, material, now());
  assert.equal(result.deactivatedPackageCount, 1);
  assert.equal(pkg.status, "source_removed");
  assert.equal(runtime.activation.status, "source_unavailable");
  assert.equal(runtime.learningPlan.status, "source_unavailable");
  assert.equal(state.privateTutorSessions[0].status, "source_unavailable");
  assert.equal(privateTutorRuntimeValidation(state, pkg.id, pkg.version), null);
  assert.equal(pkg.knowledgeComponents.length > 0, true);
});
