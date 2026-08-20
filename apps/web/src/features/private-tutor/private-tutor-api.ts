import { getCurrentSession } from "@/lib/api-client";
import { request } from "@/lib/api/request";

export interface PrivateTutorLearner {
  id: string;
  displayName: string;
  grade: string;
  curriculumEditionId: string | null;
  status: "active";
  createdAt: string;
  updatedAt: string;
}

export interface PrivateTutorKnowledgeState {
  id: string;
  mastery: number | null;
  level: "mastered" | "learning" | "needs_support" | "unknown";
  evidenceCount: number;
}

export interface PrivateTutorSnapshot {
  id: string;
  learnerId: string;
  revision: number;
  dailyMinutes: number;
  completedSessions: number;
  independentAnswers: number;
  diagnosticCompletedAt: string | null;
  latestAssessmentId: string | null;
  knowledge: PrivateTutorKnowledgeState[];
  updatedAt: string;
}

export interface PrivateTutorAssessmentQuestion {
  revisionId: string;
  knowledgeId: string;
  difficulty: number;
  kind: "numeric" | "choice";
  prompt: string;
  options: Array<{ id: string; label: string }> | null;
}

export interface PrivateTutorAssessmentResult {
  knowledge: Array<{
    knowledgeId: string;
    mastery: number | null;
    level: "mastered" | "learning" | "needs_support" | "unknown";
    evidenceCount: number;
    correctCount: number;
    dontKnowCount: number;
  }>;
  strengths: string[];
  focus: string[];
  answeredCount: number;
}

export interface PrivateTutorAssessment {
  id: string;
  learnerId: string;
  status: "active" | "paused" | "completed";
  revision: number;
  startedAt: string;
  pausedAt: string | null;
  completedAt: string | null;
  activeSeconds: number;
  targetSeconds: number;
  minQuestions: number;
  maxQuestions: number;
  answeredCount: number;
  currentQuestion: PrivateTutorAssessmentQuestion | null;
  result: PrivateTutorAssessmentResult | null;
  updatedAt: string;
}

export type PrivateTutorTeachingStrategy = "prerequisite_repair" | "concept_rebuild" | "fluency_practice" | "transfer_challenge";

export interface PrivateTutorLearnerModel {
  id: string;
  learnerId: string;
  revision: number;
  sourceSnapshotRevision: number;
  reason: string;
  knowledge: Array<{
    id: string;
    title: string;
    mastery: number | null;
    level: "mastered" | "learning" | "needs_support" | "unknown";
    confidence: number;
    evidenceCount: number;
    independentCorrect: number;
    hintedCorrect: number;
    incorrect: number;
    hintDependency: number;
    latestEvidenceAt: string | null;
    forgettingRisk: number;
    misconception: { id: string; label: string; evidenceCount: number } | null;
    prerequisiteId: string | null;
    prerequisiteGap: boolean;
  }>;
  updatedAt: string;
}

export interface PrivateTutorStrategyDecision {
  id: string;
  learnerId: string;
  modelId: string;
  targetKnowledgeId: string;
  targetTitle: string;
  strategy: PrivateTutorTeachingStrategy;
  reasonCode: string;
  studentReason: string;
  misconception: { id: string; label: string } | null;
  exitConditions: string[];
  createdAt: string;
}

export interface PrivateTutorLearningPlan {
  id: string;
  learnerId: string;
  revision: number;
  status: "active";
  reason: string;
  studentReason: string;
  generatedAt: string;
  days: Array<{
    dayIndex: number;
    date: string;
    status: "planned";
    knowledgeId: string;
    knowledgeTitle: string;
    activity: string;
    title: string;
    minutes: number;
    strategy: PrivateTutorTeachingStrategy;
    rationale: string;
  }>;
  updatedAt: string;
}

export interface PrivateTutorIntelligence {
  learnerModel: PrivateTutorLearnerModel | null;
  strategyDecision: PrivateTutorStrategyDecision | null;
  learningPlan: PrivateTutorLearningPlan | null;
}

export async function listPrivateTutorLearners() {
  const result = await request<{ learners: PrivateTutorLearner[] }>("GET", "/api/private-tutor/learners");
  return result.learners;
}

export async function createPrivateTutorLearner(input: { displayName: string; grade: string }) {
  return request<{ learner: PrivateTutorLearner; snapshot: PrivateTutorSnapshot }>(
    "POST",
    "/api/private-tutor/learners",
    input,
  );
}

export async function getPrivateTutorSnapshot(learnerId: string) {
  return request<{ learner: PrivateTutorLearner; snapshot: PrivateTutorSnapshot } & PrivateTutorIntelligence>(
    "GET",
    `/api/private-tutor/learners/${encodeURIComponent(learnerId)}/snapshot`,
  );
}

export async function rebalancePrivateTutorLearningPlan(learnerId: string, missedDayIndex: number) {
  return request<PrivateTutorIntelligence>(
    "POST",
    `/api/private-tutor/learners/${encodeURIComponent(learnerId)}/learning-plan/rebalance`,
    { missedDayIndex },
  );
}

export async function getCurrentPrivateTutorAssessment(learnerId: string) {
  const result = await request<{ assessment: PrivateTutorAssessment | null }>(
    "GET",
    `/api/private-tutor/learners/${encodeURIComponent(learnerId)}/assessments/current`,
  );
  return result.assessment;
}

export async function startPrivateTutorAssessment(learnerId: string) {
  const result = await request<{ assessment: PrivateTutorAssessment }>(
    "POST",
    `/api/private-tutor/learners/${encodeURIComponent(learnerId)}/assessments/start`,
    {},
  );
  return result.assessment;
}

export async function answerPrivateTutorAssessment(learnerId: string, assessmentId: string, input: {
  idempotencyKey: string;
  questionRevisionId: string;
  rawAnswer: string;
  responseKind: "answer" | "dont_know";
  source: "screen" | "voice_confirmed";
  recognitionConfidence?: number;
  durationSeconds: number;
}) {
  const result = await request<{ assessment: PrivateTutorAssessment; replayed: boolean }>(
    "POST",
    `/api/private-tutor/learners/${encodeURIComponent(learnerId)}/assessments/${encodeURIComponent(assessmentId)}/answers`,
    input,
  );
  return result.assessment;
}

export async function pausePrivateTutorAssessment(learnerId: string, assessmentId: string) {
  const result = await request<{ assessment: PrivateTutorAssessment }>(
    "POST",
    `/api/private-tutor/learners/${encodeURIComponent(learnerId)}/assessments/${encodeURIComponent(assessmentId)}/pause`,
    {},
  );
  return result.assessment;
}

export async function resumePrivateTutorAssessment(learnerId: string, assessmentId: string) {
  const result = await request<{ assessment: PrivateTutorAssessment }>(
    "POST",
    `/api/private-tutor/learners/${encodeURIComponent(learnerId)}/assessments/${encodeURIComponent(assessmentId)}/resume`,
    {},
  );
  return result.assessment;
}

export async function startPrivateTutorChildMode(learnerId: string, exitPin: string) {
  await request("POST", "/api/private-tutor/child-mode", { learnerId, exitPin });
  return getCurrentSession();
}

export async function exitPrivateTutorChildMode(exitPin: string) {
  await request("POST", "/api/private-tutor/child-mode/exit", { exitPin });
  return getCurrentSession();
}

export async function recordPrivateTutorAttempt(learnerId: string, input: {
  idempotencyKey: string;
  knowledgeId: string;
  questionRevisionId: string;
  rawAnswer: string;
  responseKind: "answer" | "dont_know";
  independent: boolean;
  usedHint: boolean;
  source: "screen" | "voice_confirmed" | "visual";
  recognitionConfidence?: number;
  durationSeconds: number;
}) {
  return request<{ snapshot: PrivateTutorSnapshot; replayed: boolean } & PrivateTutorIntelligence>(
    "POST",
    `/api/private-tutor/learners/${encodeURIComponent(learnerId)}/attempts`,
    input,
  );
}
