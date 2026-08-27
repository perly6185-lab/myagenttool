import { getCurrentSession } from "@/lib/api-client";
import { request } from "@/lib/api/request";
import type {
  AuthoredContentVersion,
  ContentSourceType,
  KnowledgeGraphData,
  KnowledgeMapDraft,
  LearningContentPackage,
  MaterialDocument,
} from "./private-tutor-model";

export type { AuthoredContentVersion, ContentSourceType, KnowledgeGraphData, KnowledgeMapDraft, LearningContentPackage, MaterialDocument };

export interface PrivateTutorLearner {
  id: string;
  displayName: string;
  grade: string;
  curriculumEditionId: string | null;
  status: "active";
  createdAt: string;
  updatedAt: string;
}

export type PrivateTutorTeacherStyle = "heuristic_guidance" | "direct_concept" | "case_driven" | "socratic_questioning";
export type PrivateTutorExplanationDepth = "concise_then_expand" | "from_foundations" | "key_difficulties_only" | "professional_depth";
export type PrivateTutorFollowUpStyle = "gentle_probe" | "direct_check" | "none";
export type PrivateTutorVoicePreference = "push_to_talk" | "hands_free" | "text_only";
export type PrivateTutorPlanIntensity = "relaxed" | "standard" | "intensive";

export interface PrivateTutorLearningPreferences {
  learnerId: string;
  captions: boolean;
  reducedMotion: boolean;
  dailyMinutes: number;
  planIntensity: PrivateTutorPlanIntensity;
  teacherStyle: PrivateTutorTeacherStyle;
  explanationDepth: PrivateTutorExplanationDepth;
  followUpStyle: PrivateTutorFollowUpStyle;
  voicePreference: PrivateTutorVoicePreference;
  learningGoal: {
    targetTopicIds: string[];
    weeklyMinutes: number | null;
    targetDate: string | null;
    note: string;
  } | null;
  deactivatedPackageIds: string[];
  revision: number;
  schemaVersion: number;
  updatedAt: string | null;
}

export type PrivateTutorLearningPreferencesPatch = Partial<Pick<PrivateTutorLearningPreferences,
  | "captions"
  | "reducedMotion"
  | "dailyMinutes"
  | "planIntensity"
  | "teacherStyle"
  | "explanationDepth"
  | "followUpStyle"
  | "voicePreference"
  | "learningGoal"
>>;

export interface PrivateTutorDeletionJobStatus {
  reportId: string;
  status: "pending_erasure" | "erasing" | "erasure_failed";
  attempts: number;
  requestedAt: string;
  lastAttemptAt: string | null;
  verificationOk: boolean;
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
  contentPackageId: string | null;
  contentPackageVersion: string | null;
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
  contentPackageId: string | null;
  contentPackageVersion: string | null;
  subjectId: string | null;
  knowledgeId: string;
  difficulty: number;
  kind: "numeric" | "choice" | "math_steps" | "semantic_response" | "code" | "rubric_response";
  prompt: string;
  options: Array<{ id: string; label: string }> | null;
  requiredSourceRefs?: string[];
  sourceRefs?: Array<{ sectionId: string; pageNumber: number | null; origin: string | null }>;
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
  contentPackageId: string | null;
  contentPackageVersion: string | null;
  subjectId: string;
  activationId?: string | null;
  status: "active" | "paused" | "completed";
  revision: number;
  startedAt: string;
  pausedAt: string | null;
  completedAt: string | null;
  activeSeconds: number;
  targetSeconds: number;
  minQuestions: number;
  maxQuestions: number;
  runtimeValidationId?: string | null;
  answeredCount: number;
  evidenceAnswerCount?: number;
  currentQuestion: PrivateTutorAssessmentQuestion | null;
  result: PrivateTutorAssessmentResult | null;
  updatedAt: string;
}

export type PrivateTutorTeachingStrategy = "prerequisite_repair" | "concept_rebuild" | "fluency_practice" | "transfer_challenge";

export interface PrivateTutorEvaluation {
  schemaVersion?: number;
  evaluatorId?: string;
  evaluatorVersion?: string;
  subjectId?: string;
  contentRevisionId?: string | null;
  contentPackageId?: string | null;
  contentPackageVersion?: string | null;
  rubricVersion?: string | null;
  confidence?: number | null;
  reviewStatus?: "not_required" | "required" | "completed";
  decisionFingerprint?: string;
  profile?: string;
  semanticStatus?: string;
  semanticConfidence?: number;
  speechConfidence?: number | null;
  missingCriteria?: string[];
  contradictedCriteria?: string[];
  thresholds?: { evidence?: number; review?: number; voiceEvidence?: number };
  score?: number;
  scoreBand?: string;
  anchorId?: string | null;
  anchorDescription?: string | null;
  contentScore?: number;
  contentMaximum?: number;
  sourceScore?: number;
  passedCount?: number;
  totalCount?: number;
  firstIncorrectStep?: number | null;
  requiresReview?: boolean;
  missingSourceRefs?: string[];
  unknownSourceRefs?: string[];
  reviewReason?: string | null;
  humanReviewId?: string;
  humanReviewDecision?: PrivateTutorEvaluationReviewDecision;
  humanReviewReasonCode?: PrivateTutorEvaluationReviewReasonCode;
  reviewedAt?: string;
  finalCorrect?: boolean;
  finalEvidenceEligible?: boolean;
  explanation?: string;
  criteria?: Array<Record<string, unknown>>;
  steps?: Array<{
    index?: number;
    displayIndex?: number;
    correct?: boolean;
    actual?: string | null;
    normalizedEquation?: string | null;
    classification?: string;
    feedback?: string;
    [key: string]: unknown;
  }>;
  tests?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface PrivateTutorAttemptEvaluation {
  correct: boolean;
  independent: boolean;
  usedHint: boolean;
  evidenceEligible: boolean;
  evidenceTier: string;
  evaluation: PrivateTutorEvaluation | null;
}

export type PrivateTutorEvaluationReviewDecision = "confirmed_correct" | "confirmed_incorrect";
export type PrivateTutorEvaluationReviewReasonCode =
  | "transcription_verified"
  | "semantic_interpretation"
  | "rubric_interpretation"
  | "source_verified"
  | "automated_false_positive"
  | "automated_false_negative"
  | "other";

export interface PrivateTutorEvaluationReview {
  id: string;
  learnerId: string;
  attemptId: string;
  reviewerId: string;
  automated: {
    correct: boolean;
    evidenceEligible: boolean;
    judgementReason: string;
    evidenceTier: string;
    decisionFingerprint: string;
  };
  decision: PrivateTutorEvaluationReviewDecision;
  reasonCode: PrivateTutorEvaluationReviewReasonCode;
  note: string;
  finalCorrect: boolean;
  finalEvidenceEligible: boolean;
  createdAt: string;
}

export interface PrivateTutorEvaluationReviewQueueItem {
  attemptId: string;
  learnerId: string;
  learnerDisplayName: string | null;
  contentPackageId: string | null;
  contentPackageVersion: string | null;
  subjectId: string | null;
  knowledgeId: string;
  questionRevisionId: string;
  responseKind: string;
  normalizedAnswer: string | null;
  source: string;
  recognitionConfidence: number | null;
  independent: boolean;
  usedHint: boolean;
  automatedCorrect: boolean;
  automatedEvidenceEligible: boolean;
  evaluation: PrivateTutorEvaluation;
  review: PrivateTutorEvaluationReview | null;
  createdAt: string;
}

export type PrivateTutorGoldenCandidateClassification =
  | "evaluator_defect"
  | "rubric_defect"
  | "content_defect"
  | "transcription_issue"
  | "one_off_exception";
export type PrivateTutorGoldenCandidateStatus = "migration_required" | "in_review" | "approved" | "rejected" | "exception_only";

export interface PrivateTutorGoldenExpected {
  correct: boolean;
  evidenceEligible: boolean;
  requiresReview: boolean;
  score: number | null;
  scoreBand: "insufficient" | "developing" | "proficient" | null;
}

export interface PrivateTutorGoldenCandidate {
  id: string;
  schemaVersion: 1;
  sourceEvaluationReviewId: string;
  classification: PrivateTutorGoldenCandidateClassification;
  targetChange: "evaluator" | "rubric" | "content" | "none";
  promotionEligible: boolean;
  migrationRequired: boolean;
  migration: {
    migrationId: string;
    to: { evaluatorVersion: string | null; contentPackageVersion: string | null; rubricVersion: string | null; profile: string | null };
    compatibility: string;
  } | null;
  suite: "math-step" | "language-semantic" | "conceptual-rubric";
  rationale: string;
  proposedExpected: PrivateTutorGoldenExpected;
  goldenArtifact: {
    schemaVersion: 1;
    suite: string;
    subjectId: string;
    questionRevisionId: string;
    versions: { evaluatorVersion: string | null; contentPackageVersion: string | null; rubricVersion: string | null; profile: string | null };
    input: { rawAnswer: string; responseKind: string; source: string; recognitionConfidence: number | null };
    expected: PrivateTutorGoldenExpected;
  };
  candidateFingerprint: string;
  deidentification: { passed: boolean; policyVersion: 1; detected: string[] };
  createdBy: string;
  createdAt: string;
  status: PrivateTutorGoldenCandidateStatus;
  approvals: number;
  requiredApprovals: 2;
  reviews: Array<{
    id: string;
    candidateId: string;
    reviewerId: string;
    decision: "approved" | "rejected";
    evidence: string;
    reviewedAt: string;
  }>;
}

export interface PrivateTutorLearnerModel {
  id: string;
  learnerId: string;
  contentPackageId: string | null;
  contentPackageVersion: string | null;
  subjectId: string;
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
  contentPackageId: string | null;
  contentPackageVersion: string | null;
  subjectId: string;
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
  contentPackageId: string | null;
  contentPackageVersion: string | null;
  subjectId: string;
  activationId?: string | null;
  revision: number;
  status: "active" | "completed" | "source_unavailable";
  entryMode?: "diagnostic" | "chapter";
  startModuleId?: string | null;
  startTopicId?: string | null;
  startKnowledgeId?: string | null;
  reason: string;
  studentReason: string;
  planIntensity?: PrivateTutorPlanIntensity;
  dailyMinutes?: number;
  generatedAt: string;
  days: Array<{
    dayIndex: number;
    date: string;
    status: "planned" | "in_progress" | "completed";
    startedAt?: string;
    completedAt?: string;
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

export type PrivateTutorSessionPace = "easy" | "standard" | "review";
export type PrivateTutorSessionActivityKind = "recall" | "explain" | "guided_practice" | "independent_check" | "summary";

export interface PrivateTutorVisualScene {
  schemaVersion: 1;
  revisionId: string;
  template: "number_line" | "fraction_strip" | "equation_balance" | "bar_model" | "coordinate_plane" | "comparison";
  title: string;
  ariaLabel: string;
  parameters: Record<string, unknown>;
  steps: Array<{
    id: string;
    index: number;
    startMs: number;
    durationMs: number;
    narration: string;
    stateIndex: number;
  }>;
  interaction: {
    kind: "select_value";
    prompt: string;
    choices: Array<{ id: string; label: string; value: string }>;
  } | null;
  publication: {
    status: "engineering_preview";
    contentVersion: string;
    mathValidated: boolean;
    reviewedAt: string | null;
  };
}

export interface PrivateTutorSession {
  id: string;
  learnerId: string;
  contentPackageId: string | null;
  contentPackageVersion: string | null;
  subjectId: string;
  activationId?: string | null;
  planId: string | null;
  decisionId: string | null;
  planDayIndex?: number | null;
  targetKnowledgeId: string;
  targetTitle: string;
  strategy: PrivateTutorTeachingStrategy;
  pace: PrivateTutorSessionPace;
  plannedMinutes: number;
  status: "active" | "paused" | "completed" | "source_unavailable";
  revision: number;
  currentActivityIndex: number;
  progress: Array<{ kind: PrivateTutorSessionActivityKind; budgetMinutes: number; status: "pending" | "active" | "completed" }>;
  currentActivity: {
    kind: PrivateTutorSessionActivityKind;
    budgetMinutes: number;
    hintLevel: number;
    attemptCount: number;
    instruction: string;
    question: PrivateTutorAssessmentQuestion | null;
    hint: string | null;
    visualScene?: PrivateTutorVisualScene | null;
  } | null;
  teachingMethod: string;
  subjectCapabilities: {
    deterministicGrading: boolean;
    stepEvaluation: boolean;
    speechEvaluation: boolean;
    visualInteractions: boolean;
    supportedQuestionKinds?: string[];
    semanticEvaluation?: boolean | "authored_rubric" | "source_grounded_rubric";
    codeExecution?: boolean;
    sourceGrounding?: boolean;
    sandboxProfile?: string;
  } | null;
  methodSwitchCount: number;
  intervention: { type: "gentle_hint" | "method_switch" | "prerequisite_reset"; message: string } | null;
  pausedAt: string | null;
  startedAt: string;
  completedAt: string | null;
  updatedAt: string;
  summary: {
    learned: string;
    independentCompleted: boolean;
    hintedActivities: PrivateTutorSessionActivityKind[];
    methodSwitchCount: number;
    evidenceCount: number;
    practiceCount?: number;
    reviewAt: string;
    nextStep: string;
  } | null;
}

export interface PrivateTutorVoiceTurn {
  id: string;
  learnerId: string;
  sessionId: string;
  questionRevisionId: string;
  mode: "push_to_talk" | "hands_free";
  provider: string;
  transcript: string;
  normalizedExpression: string | null;
  confidence: number;
  status: "ready" | "confirmation_required" | "unsupported" | "confirmed";
  requiresConfirmation: boolean;
  reasonCodes: Array<"low_confidence" | "alternative_mismatch" | "unsupported_math_expression">;
  attemptId: string | null;
  createdAt: string;
  confirmedAt: string | null;
}

export interface PrivateTutorReviewTheme {
  id: string;
  learnerId: string;
  contentPackageId: string | null;
  contentPackageVersion: string | null;
  subjectId: string;
  knowledgeId: string;
  title: string;
  misconception: string;
  learnerDiagnosisCorrection: string | null;
  strategy: PrivateTutorTeachingStrategy;
  status: "challenge_today" | "working" | "mastered";
  occurrenceCount: number;
  reopenedCount: number;
  latestQuestion: PrivateTutorAssessmentQuestion | null;
  latestAnswer: {
    normalizedAnswer: string | null;
    responseKind: string;
    source: string;
    recognitionConfidence: number | null;
    usedHint: boolean;
    independent: boolean;
  } | null;
  schedule: {
    id: string;
    phase: "correction" | "similar" | "variation" | "delayed";
    dueAt: string | null;
    due: boolean;
    completedAt: string | null;
    question: PrivateTutorAssessmentQuestion | null;
  } | null;
  masteredAt: string | null;
  updatedAt: string;
}

export interface PrivateTutorReviewBook {
  learnerId: string;
  counts: { challengeToday: number; working: number; mastered: number };
  themes: PrivateTutorReviewTheme[];
}

export interface PrivateTutorWeeklyReport {
  learnerId: string;
  learnerName: string;
  period: { days: number; from: string; to: string };
  progress: { completedSessions: number; learningMinutes: number; evidenceCount: number; independentCorrect: number; masteredThemeCount: number };
  highlight: string;
  evidence: string;
  nextStep: string;
  familySuggestion: string;
  pressureSafety: { rankingShown: false; dailyErrorAlertEnabled: false; comparisonWithOthers: false };
  generatedAt: string;
}

export interface PrivateTutorGuardianPreferences {
  learnerId: string;
  guardianUserId: string;
  notificationFrequency: "off" | "weekly";
  quietHours: { enabled: boolean; start: string; end: string };
  weeklyProgressSummary: boolean;
  dailyErrorAlerts: false;
  updatedAt: string | null;
}

export type PrivateTutorReleaseEvidenceType = "automated_test" | "manual_review" | "device_test" | "incident_drill" | "operations_drill";

export interface PrivateTutorReleaseEnvironment {
  deviceClass: "server" | "desktop" | "tablet" | "mobile" | "not_applicable";
  operatingSystem: "windows" | "macos" | "linux" | "ios" | "android" | "not_applicable";
  browserEngine: "chromium" | "firefox" | "webkit" | "not_applicable";
  networkProfile: "stable" | "constrained" | "offline_recovery" | "not_applicable";
}

export interface PrivateTutorReleaseTarget {
  id: string;
  label: string;
  evidenceType: PrivateTutorReleaseEvidenceType;
  environment: PrivateTutorReleaseEnvironment;
  status: "passed" | "failed" | "expired" | "not_evaluated";
  requiredReviewers: number;
  passedReviewers: number;
  expiredEvidenceCount: number;
  latestEvidence: string | null;
  latestArtifact: { name: string; checksumSha256: string } | null;
  executedAt: string | null;
  expiresAt: string | null;
  evaluatedAt: string | null;
}

export interface PrivateTutorReleaseGate {
  id: string;
  label: string;
  required: true;
  doubleReview: boolean;
  evidenceValidityDays: number;
  status: "passed" | "failed" | "expired" | "incomplete" | "not_evaluated";
  targets: PrivateTutorReleaseTarget[];
  completedTargets: number;
  missingTargetIds: string[];
  expiredEvidenceCount: number;
  passedReviewers: number;
  latestEvidence: string | null;
  evaluatedAt: string | null;
}

export interface PrivateTutorReleaseReadiness {
  status: "ready_for_controlled_pilot" | "blocked";
  ready: boolean;
  gates: PrivateTutorReleaseGate[];
  buildId: string;
  scopeChecksum: string;
  evaluatedAt: string;
  evidenceContractVersion: 2;
  rule: string;
}

export interface PrivateTutorPilotCohort {
  id: string;
  status: "active" | "paused" | "completed";
  participantTarget: number;
  durationDays: 7;
  responseOwner: string;
  consentDocumentId: string;
  consentDocumentVersion: string;
  consentDocumentChecksum: string;
  exitPolicy: "guardian_can_withdraw_and_request_deletion";
  createdBy: string;
  startedAt: string;
  endsAt: string;
  pausedAt: string | null;
  pausedBy: string | null;
  pauseReason: string | null;
  enrolledLearnerIds?: string[];
}

export interface PrivateTutorPilotConsentDocument {
  id: string;
  version: string;
  effectiveAt: string;
  title: string;
  summary: string;
  terms: Array<{ id: string; label: string }>;
  checksum: string;
}

export interface PrivateTutorPilotParticipation {
  id: string;
  cohortId: string;
  learnerId: string;
  status: "active" | "withdrawn" | "completed";
  consentId: string;
  enrolledAt: string;
  withdrawnAt: string | null;
  withdrawalReason: string | null;
}

export interface PrivateTutorPilotIncident {
  id: string;
  cohortId: string;
  learnerId: string;
  category: "content_error" | "voice_misrecognition" | "child_distress" | "privacy" | "access" | "other";
  severity: "low" | "moderate" | "high" | "critical";
  summary: string;
  status: "open" | "escalated" | "resolved";
  createdAt: string;
  resolution: string | null;
}

export interface PrivateTutorPilotMetrics {
  cohortId: string;
  status: "active" | "paused" | "completed";
  participantTarget: number;
  enrollment: { consented: number; active: number; withdrawn: number; capacityRemaining: number };
  engagement: { learnersWithCompletedSessions: number; returningLearners: number; completedSessions: number; learningMinutes: number; evidenceCount: number; independentCorrectRate: number | null; hintDependenceRate: number | null };
  experience: { checkInCount: number; guardianPressure: Record<"low" | "manageable" | "high", number>; childWillingToReturn: Record<"yes" | "unsure" | "no", number> };
  safety: { total: number; open: number; escalated: number; critical: number };
  privacy: { learnerIdsExposed: false; rawAnswersExposed: false; incidentFreeTextExposed: false };
  generatedAt: string;
}

export interface PrivateTutorPilotGuardianStatus {
  cohort: PrivateTutorPilotCohort | null;
  consentDocument: PrivateTutorPilotConsentDocument | null;
  participation: PrivateTutorPilotParticipation | null;
  consent: { id: string; documentVersion: string; documentChecksum: string; acceptedAt: string } | null;
  incidents: PrivateTutorPilotIncident[];
  checkIns: Array<{ id: string; guardianPressure: "low" | "manageable" | "high"; childWillingToReturn: "yes" | "unsure" | "no"; day: string; createdAt: string }>;
  deletionRequests: Array<{ id: string; status: "pending_parent_confirmation"; requestedAt: string }>;
  canJoin: boolean;
}

export interface PrivateTutorQuestionRevision {
  id: string;
  questionId: string;
  version: number;
  context: "diagnostic" | "practice" | "tutoring" | "review";
  knowledgeId: "integer" | "equation-meaning" | "balance" | "word-problem";
  difficulty: number;
  kind: "numeric" | "choice";
  prompt: string;
  options: Array<{ id: string; label: string }> | null;
  expectedChoice: string | null;
  expectedAnswer: string | null;
  allowVariableAssignment: boolean;
  contentChecksum: string;
  createdBy: string;
  createdAt: string;
  status: "draft" | "in_review" | "approved" | "rejected" | "published" | "superseded" | "disabled";
  active: boolean;
  approvals: number;
  requiredApprovals: 2;
  reviews: Array<{ id: string; reviewerId: string; decision: "approved" | "rejected"; evidence: string; reviewedAt: string }>;
}

export interface PrivateTutorQuestionRevisionInput {
  questionId: string;
  context: PrivateTutorQuestionRevision["context"];
  knowledgeId: PrivateTutorQuestionRevision["knowledgeId"];
  difficulty: number;
  kind: PrivateTutorQuestionRevision["kind"];
  prompt: string;
  expectedAnswer?: string;
  expectedChoice?: string;
  options?: Array<{ id: string; label: string }>;
  allowVariableAssignment?: boolean;
}

export interface PrivateTutorGuardianInvitation {
  id: string;
  learnerId: string;
  invitedBy: string;
  inviteeLabel: string | null;
  permissions: Array<"read" | "write" | "manage">;
  status: "pending" | "accepted" | "expired";
  createdAt: string;
  expiresAt: string;
  acceptedBy: string | null;
  acceptedAt: string | null;
}

export interface PrivateTutorDataPolicy {
  id: string | null;
  learnerId: string;
  rawAudioDays: 0;
  voiceTranscriptDays: 0 | 7 | 30 | 90 | 365;
  derivedProfileHistoryDays: 180 | 365 | 730;
  learningEvidenceRetention: "until_learner_deletion";
  updatedAt: string | null;
}

export interface PrivateTutorDeletionPreview {
  learnerId: string;
  totalRecords: number;
  collectionCounts: Record<string, number>;
  retainedAfterDeletion: string[];
  requiresExactDisplayName: true;
}

export interface PrivateTutorProfileResult {
  profile: PrivateTutorLearner | null;
  migrationRequired: false;
}

export async function getPrivateTutorProfile() {
  return request<PrivateTutorProfileResult>("GET", "/api/private-tutor/profile");
}

export async function createPrivateTutorProfile(input: { displayName: string; grade: string; curriculumEditionId?: string }) {
  return request<{
    profile: PrivateTutorLearner;
    snapshot?: PrivateTutorSnapshot;
    created: boolean;
    migrationRequired: false;
  }>("POST", "/api/private-tutor/profile", input);
}

export async function getPrivateTutorLearningPreferences() {
  const result = await request<{ preferences: PrivateTutorLearningPreferences }>("GET", "/api/private-tutor/profile/preferences");
  return result.preferences;
}

export async function updatePrivateTutorLearningPreferences(preferences: PrivateTutorLearningPreferencesPatch) {
  const result = await request<{ preferences: PrivateTutorLearningPreferences }>("PUT", "/api/private-tutor/profile/preferences", { preferences });
  return result.preferences;
}

export interface PrivateTutorProfileMigrationCandidate {
  learnerId: string;
  displayName: string;
  grade: string;
  createdAt: string;
  updatedAt: string;
  evidence: {
    attempts: number;
    assessments: number;
    tutoringSessions: number;
    reviewSchedules: number;
    auditEvents: number;
  };
  evidenceTotal: number;
}

export interface PrivateTutorProfileMigrationReport {
  migrationRequired: boolean;
  profileCount: number;
  candidates: PrivateTutorProfileMigrationCandidate[];
  recommendedKeepLearnerId: string | null;
}

export interface PrivateTutorProfileMigrationPlan {
  keepLearnerId: string;
  discardLearnerIds: string[];
  dryRun: boolean;
  rewrites: Record<string, number>;
  rewrittenTotal: number;
  cohortRewrites: number;
  childModeSessionRewrites: number;
  discardedProfileCount: number;
}

export interface PrivateTutorProfileMigrationResult {
  merged: boolean;
  dryRun: boolean;
  plan: PrivateTutorProfileMigrationPlan;
  audit?: { id: string; action: string; at: string };
  rollbackReceipt?: {
    id: string;
    keepLearnerId: string;
    discardLearnerIds: string[];
    appliedAt: string;
    rewrittenTotal: number;
    rollbackCheck: { residualDiscardReferences: number; expectedResidualDiscardReferences: number };
  };
}

export async function getPrivateTutorProfileMigrationReport() {
  return request<PrivateTutorProfileMigrationReport>("GET", "/api/private-tutor/profile/migration");
}

export async function confirmPrivateTutorProfileMigration(input: { keepLearnerId: string; discardLearnerIds: string[]; dryRun?: boolean }) {
  return request<PrivateTutorProfileMigrationResult>("POST", "/api/private-tutor/profile/migration", input);
}

export async function deletePrivateTutorProfile(confirmDisplayName: string) {
  return request<{ deletedId: string; deletionReport: { id: string; liveStateResidualCount: number; durableVerification: { backing: "sqlite" | "json" | "memory"; durableResidualCount: number; secureDelete: boolean; walCheckpointed: boolean; checkpointBusy: number | null; remainingLogFrames: number | null; logicalPersistenceSucceeded: boolean; jsonRollbackArtifactUpdated: boolean; reportPersisted: boolean; compactionError: string | null; ok: boolean } } }>("DELETE", "/api/private-tutor/profile", { confirmDisplayName });
}

/** @deprecated 旧家庭多孩子模型兼容面，仅 LegacyFamilyTutorEntry 使用；新代码走 /profile。 */
export async function listPrivateTutorLearners() {
  const result = await request<{ learners: PrivateTutorLearner[] }>("GET", "/api/private-tutor/learners");
  return result.learners;
}

/** @deprecated 旧家庭多孩子模型兼容面，仅 LegacyFamilyTutorEntry 使用；新代码走 /profile。 */
export async function createPrivateTutorLearner(input: { displayName: string; grade: string; curriculumEditionId?: string }) {
  return request<{ learner: PrivateTutorLearner; snapshot: PrivateTutorSnapshot }>(
    "POST",
    "/api/private-tutor/learners",
    input,
  );
}

export interface PrivateTutorContentPackageListResult {
  packages: LearningContentPackage[];
}

export interface PrivateTutorContentPackageResult {
  package: LearningContentPackage;
}

export interface PrivateTutorKnowledgeGraphResult {
  knowledgeGraph: KnowledgeGraphData;
}

export interface PrivateTutorActiveContentPackageResult {
  activePackage: LearningContentPackage | null;
}

export interface PrivateTutorContentPackageUpdateResult {
  activePackage: LearningContentPackage;
  snapshot: PrivateTutorSnapshot | null;
}

export interface PrivateTutorRuntimeValidation {
  id: string;
  packageId: string;
  packageVersion: string;
  status: "passed" | "blocked" | "superseded" | "revoked";
  failureCodes: string[];
  validatedAt: string;
  questions: Array<{
    questionRevisionId: string;
    context: string;
    status: "passed" | "blocked";
    failureCodes: string[];
  }>;
}

export interface PrivateTutorPackageActivation {
  id: string;
  learnerId: string;
  packageId: string;
  packageVersion: string;
  entryMode: "diagnostic" | "chapter";
  startModuleId: string | null;
  startTopicId: string | null;
  startKnowledgeId: string | null;
  scopeKnowledgeIds: string[];
  runtimeValidationId: string | null;
  status: "active" | "inactive" | "source_unavailable";
  activatedAt: string;
}

export interface PrivateTutorPackageActivationResult extends PrivateTutorContentPackageUpdateResult, PrivateTutorIntelligence {
  activation: PrivateTutorPackageActivation;
  runtimeValidation: PrivateTutorRuntimeValidation | null;
}

export interface PrivateTutorContentMigrationCandidate {
  packageId: string;
  packageVersion: string;
  packageName: string;
  sourceType: ContentSourceType;
  status: string;
  contentChecksum: string | null;
  knowledgeCount: number;
  hasLearningState: boolean;
  evidenceCount: number;
}

export interface PrivateTutorContentMigrationMapping {
  sourceKnowledgeId: string;
  sourceName: string;
  targetKnowledgeIds: string[];
  targetNames: string[];
  sourceEvidenceCount: number;
  relation: "unchanged" | "renamed" | "changed" | "split" | "merged" | "removed";
  compatibility: "safe" | "review_required" | "archive_only";
  decision: "transfer" | "provisional" | "archive";
  changes: string[];
}

export interface PrivateTutorContentMigrationPreview {
  id: string;
  revision: number;
  status: "draft" | "confirmed" | "applied" | "rolled_back";
  source: { packageId: string; packageVersion: string; packageName: string; contentChecksum: string };
  target: { packageId: string; packageVersion: string; packageName: string; contentChecksum: string };
  mappings: PrivateTutorContentMigrationMapping[];
  targetAdditions: Array<{ knowledgeId: string; name: string; status: "added" }>;
  impact: {
    transferableKnowledgeCount: number;
    provisionalKnowledgeCount: number;
    archivedKnowledgeCount: number;
    addedKnowledgeCount: number;
    transferableEvidenceCount: number;
    provisionalEvidenceCount: number;
    archivedEvidenceCount: number;
    affectedActivePlanCount: number;
    affectedOpenSessionCount: number;
    activeRuntimeWillChange: false;
    targetActivationRequired: true;
    targetStateExists: boolean;
    requiresExplicitConfirmation: boolean;
  };
  previewFingerprint: string;
  applicationId: string | null;
}

export interface PrivateTutorContentMigrationApplication {
  id: string;
  previewId: string;
  previewFingerprint: string;
  status: "applied" | "rolled_back";
  source: PrivateTutorContentMigrationPreview["source"];
  target: PrivateTutorContentMigrationPreview["target"];
  transferredKnowledgeCount: number;
  provisionalKnowledgeCount: number;
  archivedKnowledgeCount: number;
  appliedAt: string;
  rolledBackAt: string | null;
  rollbackReceipt: { sourceFactCountBefore: number; sourceFactCountAfter: number; sourceFactsRewritten: 0; targetStateFingerprint: string; targetPackageWasActivated: false };
  rollbackVerification: { targetStatePresent: boolean; sourceFactsRewritten: 0 } | null;
}

export async function listPrivateTutorContentMigrationCandidates() {
  const result = await request<{ candidates: PrivateTutorContentMigrationCandidate[] }>("GET", "/api/private-tutor/profile/content-migrations/candidates");
  return result.candidates;
}

export async function createPrivateTutorContentMigrationPreview(input: { sourcePackageId: string; sourcePackageVersion: string; targetPackageId: string; targetPackageVersion: string; idempotencyKey: string }) {
  const result = await request<{ preview: PrivateTutorContentMigrationPreview }>("POST", "/api/private-tutor/profile/content-migrations/preview", input);
  return result.preview;
}

export async function updatePrivateTutorContentMigrationMapping(previewId: string, input: { expectedRevision: number; mappings: Array<Pick<PrivateTutorContentMigrationMapping, "sourceKnowledgeId" | "targetKnowledgeIds" | "decision">> }) {
  const result = await request<{ preview: PrivateTutorContentMigrationPreview }>("PUT", `/api/private-tutor/profile/content-migrations/${encodeURIComponent(previewId)}/mapping`, input);
  return result.preview;
}

export async function confirmPrivateTutorContentMigration(previewId: string, input: { expectedRevision: number; previewFingerprint: string; acknowledgeHistoricalPreservation: boolean; acknowledgeRiskyMappings: boolean }) {
  const result = await request<{ preview: PrivateTutorContentMigrationPreview }>("POST", `/api/private-tutor/profile/content-migrations/${encodeURIComponent(previewId)}/confirm`, input);
  return result.preview;
}

export async function applyPrivateTutorContentMigration(previewId: string, previewFingerprint: string, idempotencyKey: string) {
  const result = await request<{ application: PrivateTutorContentMigrationApplication }>("POST", `/api/private-tutor/profile/content-migrations/${encodeURIComponent(previewId)}/apply`, { previewFingerprint, idempotencyKey });
  return result.application;
}

export async function rollbackPrivateTutorContentMigration(applicationId: string) {
  const result = await request<{ application: PrivateTutorContentMigrationApplication }>("POST", `/api/private-tutor/profile/content-migration-applications/${encodeURIComponent(applicationId)}/rollback`, { confirmRollback: true });
  return result.application;
}

export async function listPrivateTutorContentPackages(filters: { sourceType?: ContentSourceType; domain?: string } = {}) {
  const params = new URLSearchParams();
  if (filters.sourceType) params.set("sourceType", filters.sourceType);
  if (filters.domain) params.set("domain", filters.domain);
  const query = params.toString();
  const result = await request<PrivateTutorContentPackageListResult>(
    "GET",
    `/api/private-tutor/content-packages${query ? `?${query}` : ""}`,
  );
  return result.packages;
}

export async function getPrivateTutorContentPackage(packageId: string) {
  const result = await request<PrivateTutorContentPackageResult>(
    "GET",
    `/api/private-tutor/content-packages/${encodeURIComponent(packageId)}`,
  );
  return result.package;
}

export async function getPrivateTutorKnowledgeGraph(packageId: string) {
  const result = await request<PrivateTutorKnowledgeGraphResult>(
    "GET",
    `/api/private-tutor/content-packages/${encodeURIComponent(packageId)}/knowledge-graph`,
  );
  return result.knowledgeGraph;
}

export async function getPrivateTutorActiveContentPackage() {
  const result = await request<PrivateTutorActiveContentPackageResult>(
    "GET",
    "/api/private-tutor/profile/content-package",
  );
  return result.activePackage;
}

export async function updatePrivateTutorActiveContentPackage(packageId: string) {
  const result = await request<PrivateTutorContentPackageUpdateResult>(
    "PUT",
    "/api/private-tutor/profile/content-package",
    { packageId },
  );
  return result;
}

export interface PrivateTutorMaterialListResult {
  materials: MaterialDocument[];
}

export interface PrivateTutorMaterialResult {
  material: MaterialDocument;
}

export interface PrivateTutorKnowledgeMapDraftResult {
  draft: KnowledgeMapDraft;
}

export async function activatePrivateTutorContentPackage(input: {
  packageId: string;
  entryMode: "diagnostic" | "chapter";
  startModuleId?: string;
  startTopicId?: string;
  startKnowledgeId?: string;
}) {
  return request<PrivateTutorPackageActivationResult>(
    "POST",
    "/api/private-tutor/profile/content-package/activate",
    input,
  );
}

export interface PrivateTutorAuthoredContentResult extends PrivateTutorKnowledgeMapDraftResult {
  authoredContent: AuthoredContentVersion;
}

export async function listPrivateTutorMaterials() {
  const result = await request<PrivateTutorMaterialListResult>("GET", "/api/private-tutor/materials");
  return result.materials;
}

export async function uploadPrivateTutorMaterial(input: {
  fileName: string;
  fileType: string;
  fileContent: string;
  fileEncoding?: "utf8" | "base64";
  fileSize?: number;
}) {
  const result = await request<PrivateTutorMaterialResult>("POST", "/api/private-tutor/materials", input);
  return result.material;
}

export async function getPrivateTutorMaterial(materialId: string) {
  const result = await request<PrivateTutorMaterialResult>(
    "GET",
    `/api/private-tutor/materials/${encodeURIComponent(materialId)}`,
  );
  return result.material;
}

export async function deletePrivateTutorMaterial(materialId: string) {
  return request<{ deleted: boolean }>(
    "DELETE",
    `/api/private-tutor/materials/${encodeURIComponent(materialId)}`,
  );
}

export async function generatePrivateTutorKnowledgeMapDraft(materialId: string, input: {
  packageName: string;
  subjectId?: string;
  domain?: string;
}) {
  const result = await request<PrivateTutorKnowledgeMapDraftResult>(
    "POST",
    `/api/private-tutor/materials/${encodeURIComponent(materialId)}/generate-draft`,
    input,
  );
  return result.draft;
}

export async function getPrivateTutorKnowledgeMapDraft(draftId: string) {
  const result = await request<PrivateTutorKnowledgeMapDraftResult>(
    "GET",
    `/api/private-tutor/knowledge-map-drafts/${encodeURIComponent(draftId)}`,
  );
  return result.draft;
}

export async function updatePrivateTutorKnowledgeMapDraft(draftId: string, input: {
  packageName?: string;
  subjectId?: string;
  domain?: string;
  draftModules?: KnowledgeMapDraft["draftModules"];
  draftTopics?: KnowledgeMapDraft["draftTopics"];
  draftKnowledgeComponents?: KnowledgeMapDraft["draftKnowledgeComponents"];
}) {
  const result = await request<PrivateTutorKnowledgeMapDraftResult>(
    "PUT",
    `/api/private-tutor/knowledge-map-drafts/${encodeURIComponent(draftId)}`,
    input,
  );
  return result.draft;
}

export async function confirmPrivateTutorKnowledgeMapDraft(draftId: string, input: {
  expectedRevision: number;
  acknowledgeSourceReview: true;
}) {
  const result = await request<PrivateTutorKnowledgeMapDraftResult>(
    "POST",
    `/api/private-tutor/knowledge-map-drafts/${encodeURIComponent(draftId)}/confirm`,
    input,
  );
  return result.draft;
}

export async function generatePrivateTutorAuthoredContent(draftId: string, input: { forceRegenerate?: boolean } = {}) {
  return request<PrivateTutorAuthoredContentResult>(
    "POST",
    `/api/private-tutor/knowledge-map-drafts/${encodeURIComponent(draftId)}/author-content`,
    input,
  );
}

export async function updatePrivateTutorAuthoredContent(draftId: string, input: {
  knowledgeContents: AuthoredContentVersion["knowledgeContents"];
}) {
  return request<PrivateTutorAuthoredContentResult>(
    "PUT",
    `/api/private-tutor/knowledge-map-drafts/${encodeURIComponent(draftId)}/authored-content`,
    input,
  );
}

export async function confirmPrivateTutorAuthoredContent(draftId: string, input: {
  expectedRevision: number;
  acknowledgeContentReview: true;
}) {
  return request<PrivateTutorAuthoredContentResult>(
    "POST",
    `/api/private-tutor/knowledge-map-drafts/${encodeURIComponent(draftId)}/authored-content/confirm`,
    input,
  );
}

export async function publishPrivateTutorKnowledgeMapDraft(draftId: string) {
  return request<{ success: boolean; packageId: string }>(
    "POST",
    `/api/private-tutor/knowledge-map-drafts/${encodeURIComponent(draftId)}/publish`,
  );
}

export interface PrivateTutorSnapshotResponse {
  learner: PrivateTutorLearner;
  profile: PrivateTutorLearner;
  snapshot: PrivateTutorSnapshot;
  learnerModel?: PrivateTutorLearnerModel | null;
  strategyDecision?: PrivateTutorStrategyDecision | null;
  learningPlan?: PrivateTutorLearningPlan | null;
}

export interface PrivateTutorLearningHistoryMetrics {
  sessionCount: number;
  completedSessionCount: number;
  startedPlanDayCount: number;
  completedPlanDayCount: number;
  planDayCompletionRate: number | null;
  currentPlan: {
    planId: string | null;
    status: string | null;
    scheduledDays: number;
    completedDays: number;
    inProgressDays: number;
  };
  practiceAttemptCount: number;
  eligibleEvidenceCount: number;
  evidenceEligibilityRate: number | null;
  independentAttemptCount: number;
  independentCorrectCount: number;
  independentCorrectRate: number | null;
  review: { scheduledCount: number; completedCount: number; dueCount: number; upcomingCount: number };
  sourceRubric: {
    attemptCount: number;
    requiredReviewCount: number;
    completedReviewCount: number;
    pendingReviewCount: number;
    reviewCompletionRate: number | null;
  };
}

export interface PrivateTutorLearningHistory {
  schemaVersion: number;
  learnerId: string;
  generatedAt: string;
  definitions: Record<string, string>;
  summary: {
    packageCount: number;
    chapterCount: number;
    sessionCount: number;
    completedSessionCount: number;
    startedPlanDayCount: number;
    completedPlanDayCount: number;
    planDayCompletionRate: number | null;
    practiceAttemptCount: number;
    eligibleEvidenceCount: number;
    evidenceEligibilityRate: number | null;
    independentAttemptCount: number;
    independentCorrectCount: number;
    independentCorrectRate: number | null;
    scheduledReviewCount: number;
    completedReviewCount: number;
    dueReviewCount: number;
    upcomingReviewCount: number;
    sourceRubricAttemptCount: number;
    sourceRubricRequiredReviewCount: number;
    sourceRubricCompletedReviewCount: number;
    sourceRubricReviewCompletionRate: number | null;
  };
  packages: Array<{
    packageId: string;
    packageVersion: string;
    packageName: string;
    sourceType: ContentSourceType | null;
    packageStatus: string;
    contentDefinitionAvailable: boolean;
    firstActivityAt: string | null;
    lastActivityAt: string | null;
    activationCount: number;
    assessmentCount: number;
    completedAssessmentCount: number;
    summary: PrivateTutorLearningHistoryMetrics;
    chapters: Array<{
      moduleId: string;
      moduleName: string;
      orderIndex: number;
      knowledgeCount: number;
      firstActivityAt: string | null;
      lastActivityAt: string | null;
      summary: PrivateTutorLearningHistoryMetrics;
      topics: Array<{ topicId: string; topicName: string; knowledgeIds: string[] }>;
    }>;
    recentSessions: Array<{
      id: string;
      status: string;
      moduleId: string;
      moduleName: string;
      knowledgeId: string;
      knowledgeTitle: string;
      planId: string | null;
      planDayIndex: number | null;
      practiceCount: number;
      evidenceCount: number;
      startedAt: string | null;
      completedAt: string | null;
      reviewAt: string | null;
    }>;
  }>;
}

export async function getPrivateTutorSnapshot() {
  return request<PrivateTutorSnapshotResponse>(
    "GET",
    "/api/private-tutor/profile/snapshot",
  );
}

export async function getPrivateTutorLearningPlan() {
  return request<PrivateTutorIntelligence>("GET", "/api/private-tutor/profile/learning-plan");
}

export async function getPrivateTutorLearningHistory() {
  const result = await request<{ history: PrivateTutorLearningHistory }>(
    "GET",
    "/api/private-tutor/profile/learning-history",
  );
  return result.history;
}

export async function rebalancePrivateTutorLearningPlan(missedDayIndex: number) {
  return request<PrivateTutorIntelligence>(
    "POST",
    "/api/private-tutor/profile/learning-plan/rebalance",
    { missedDayIndex },
  );
}

export async function getCurrentPrivateTutorSession() {
  const result = await request<{ session: PrivateTutorSession | null }>(
    "GET",
    "/api/private-tutor/profile/tutoring-sessions/current",
  );
  return result.session;
}

export async function startPrivateTutorSession(pace: PrivateTutorSessionPace) {
  return request<{ session: PrivateTutorSession; resumedExisting: boolean }>(
    "POST",
    "/api/private-tutor/profile/tutoring-sessions/start",
    { pace },
  );
}

export async function pausePrivateTutorSession(sessionId: string) {
  return request<{ session: PrivateTutorSession }>(
    "POST",
    `/api/private-tutor/profile/tutoring-sessions/${encodeURIComponent(sessionId)}/pause`,
    {},
  );
}

export async function resumePrivateTutorSession(sessionId: string) {
  return request<{ session: PrivateTutorSession }>(
    "POST",
    `/api/private-tutor/profile/tutoring-sessions/${encodeURIComponent(sessionId)}/resume`,
    {},
  );
}

export async function actOnPrivateTutorSession(sessionId: string, input:
  | { action: "continue" | "hint" }
  | {
    action: "answer";
    idempotencyKey: string;
    questionRevisionId: string;
    rawAnswer: string;
    responseKind: "answer" | "dont_know";
    source: "screen" | "voice_confirmed" | "visual";
    recognitionConfidence?: number;
    voiceTurnId?: string;
  }) {
  return request<{
    session: PrivateTutorSession;
    snapshot?: PrivateTutorSnapshot;
    answer?: PrivateTutorAttemptEvaluation;
    voiceTurn?: PrivateTutorVoiceTurn | null;
    replayed?: boolean;
  } & Partial<PrivateTutorIntelligence>>(
    "POST",
    `/api/private-tutor/profile/tutoring-sessions/${encodeURIComponent(sessionId)}/actions`,
    input,
  );
}

export async function createPrivateTutorVoiceTurn(sessionId: string, input: {
  clientTurnId: string;
  transcript: string;
  confidence: number;
  alternatives: string[];
  mode: "push_to_talk" | "hands_free";
  provider: "browser_web_speech";
}) {
  return request<{ voiceTurn: PrivateTutorVoiceTurn; replayed: boolean }>(
    "POST",
    `/api/private-tutor/profile/tutoring-sessions/${encodeURIComponent(sessionId)}/voice-turns`,
    input,
  );
}

export async function recordPrivateTutorVoiceEvent(sessionId: string, input: {
  type: "recognition_started" | "recognition_stopped" | "recognition_error" | "playback_started" | "playback_completed" | "playback_interrupted" | "mode_changed";
  reason?: string;
}) {
  return request<{ event: { id: string; type: string; createdAt: string } }>(
    "POST",
    `/api/private-tutor/profile/tutoring-sessions/${encodeURIComponent(sessionId)}/voice-events`,
    input,
  );
}

export async function getCurrentPrivateTutorAssessment() {
  const result = await request<{ assessment: PrivateTutorAssessment | null }>(
    "GET",
    "/api/private-tutor/profile/assessments/current",
  );
  return result.assessment;
}

export async function startPrivateTutorAssessment() {
  const result = await request<{ assessment: PrivateTutorAssessment }>(
    "POST",
    "/api/private-tutor/profile/assessments/start",
    {},
  );
  return result.assessment;
}

export async function answerPrivateTutorAssessment(assessmentId: string, input: {
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
    `/api/private-tutor/profile/assessments/${encodeURIComponent(assessmentId)}/answers`,
    input,
  );
  return result.assessment;
}

export async function pausePrivateTutorAssessment(assessmentId: string) {
  const result = await request<{ assessment: PrivateTutorAssessment }>(
    "POST",
    `/api/private-tutor/profile/assessments/${encodeURIComponent(assessmentId)}/pause`,
    {},
  );
  return result.assessment;
}

export async function resumePrivateTutorAssessment(assessmentId: string) {
  const result = await request<{ assessment: PrivateTutorAssessment }>(
    "POST",
    `/api/private-tutor/profile/assessments/${encodeURIComponent(assessmentId)}/resume`,
    {},
  );
  return result.assessment;
}

/** @deprecated 儿童模式属于旧家庭模型，M1 个人档案流程不再使用。 */
export async function startPrivateTutorChildMode(learnerId: string, exitPin: string) {
  await request("POST", "/api/private-tutor/child-mode", { learnerId, exitPin });
  return getCurrentSession();
}

/** @deprecated 儿童模式属于旧家庭模型，M1 个人档案流程不再使用。 */
export async function exitPrivateTutorChildMode(exitPin: string) {
  await request("POST", "/api/private-tutor/child-mode/exit", { exitPin });
  return getCurrentSession();
}

export async function recordPrivateTutorAttempt(input: {
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
  return request<{
    attempt: PrivateTutorAttemptEvaluation & { id: string; normalizedAnswer: string | null; judgementReason: string };
    snapshot: PrivateTutorSnapshot;
    replayed: boolean;
  } & PrivateTutorIntelligence>(
    "POST",
    "/api/private-tutor/profile/attempts",
    input,
  );
}

export async function getPrivateTutorReviewBook() {
  const result = await request<{ reviewBook: PrivateTutorReviewBook }>("GET", "/api/private-tutor/profile/review");
  return result.reviewBook;
}

export async function answerPrivateTutorReview(scheduleId: string, input: {
  idempotencyKey: string;
  questionRevisionId: string;
  rawAnswer: string;
  responseKind: "answer" | "dont_know";
  source: "screen" | "voice_confirmed" | "visual";
  recognitionConfidence?: number;
  durationSeconds?: number;
}) {
  return request<{ reviewBook: PrivateTutorReviewBook; snapshot: PrivateTutorSnapshot; replayed: boolean }>("POST", `/api/private-tutor/profile/review/schedules/${encodeURIComponent(scheduleId)}/answers`, input);
}

export async function correctPrivateTutorReviewDiagnosis(themeId: string, correction: string) {
  const result = await request<{ reviewBook: PrivateTutorReviewBook }>("POST", `/api/private-tutor/profile/review/themes/${encodeURIComponent(themeId)}/diagnosis`, { correction });
  return result.reviewBook;
}

export async function getPrivateTutorWeeklyReport() {
  const result = await request<{ report: PrivateTutorWeeklyReport }>("GET", "/api/private-tutor/profile/guardian/weekly-report");
  return result.report;
}

export async function getPrivateTutorGuardianPreferences() {
  const result = await request<{ preferences: PrivateTutorGuardianPreferences }>("GET", "/api/private-tutor/profile/guardian/preferences");
  return result.preferences;
}

export async function updatePrivateTutorGuardianPreferences(input: Pick<PrivateTutorGuardianPreferences, "notificationFrequency" | "quietHours" | "weeklyProgressSummary">) {
  const result = await request<{ preferences: PrivateTutorGuardianPreferences }>("PUT", "/api/private-tutor/profile/guardian/preferences", input);
  return result.preferences;
}

export async function getPrivateTutorReleaseReadiness() {
  const result = await request<{ readiness: PrivateTutorReleaseReadiness }>("GET", "/api/private-tutor/release-readiness");
  return result.readiness;
}

export async function listPrivateTutorEvaluationReviews(status: "required" | "completed" = "required") {
  const result = await request<{ queue: PrivateTutorEvaluationReviewQueueItem[] }>(
    "GET",
    `/api/private-tutor/evaluation-reviews?status=${encodeURIComponent(status)}`,
  );
  return result.queue;
}

export async function resolvePrivateTutorEvaluationReview(attemptId: string, input: {
  idempotencyKey: string;
  decisionFingerprint: string;
  decision: PrivateTutorEvaluationReviewDecision;
  reasonCode: PrivateTutorEvaluationReviewReasonCode;
  note?: string;
}) {
  return request<{
    review: PrivateTutorEvaluationReview;
    item: PrivateTutorEvaluationReviewQueueItem;
    snapshot: PrivateTutorSnapshot | null;
    masteryRecomputed: boolean;
    replayed: boolean;
  } & PrivateTutorIntelligence>(
    "POST",
    `/api/private-tutor/evaluation-reviews/${encodeURIComponent(attemptId)}`,
    input,
  );
}

export async function listPrivateTutorGoldenCandidates(status?: PrivateTutorGoldenCandidateStatus) {
  const suffix = status ? `?status=${encodeURIComponent(status)}` : "";
  const result = await request<{ candidates: PrivateTutorGoldenCandidate[] }>(
    "GET",
    `/api/private-tutor/golden-candidates${suffix}`,
  );
  return result.candidates;
}

export async function createPrivateTutorGoldenCandidate(input: {
  evaluationReviewId: string;
  classification: PrivateTutorGoldenCandidateClassification;
  deidentifiedAnswer: string;
  rationale: string;
  expectedRequiresReview?: boolean;
  expectedScore?: number;
  expectedScoreBand?: "insufficient" | "developing" | "proficient";
}) {
  const result = await request<{ candidate: PrivateTutorGoldenCandidate }>("POST", "/api/private-tutor/golden-candidates", input);
  return result.candidate;
}

export async function linkPrivateTutorGoldenCandidateMigration(candidateId: string, migrationId: string) {
  const result = await request<{ candidate: PrivateTutorGoldenCandidate }>(
    "POST",
    `/api/private-tutor/golden-candidates/${encodeURIComponent(candidateId)}/migration`,
    { migrationId },
  );
  return result.candidate;
}

export async function reviewPrivateTutorGoldenCandidate(candidateId: string, decision: "approved" | "rejected", evidence: string) {
  return request<{
    candidate: PrivateTutorGoldenCandidate;
    review: PrivateTutorGoldenCandidate["reviews"][number];
  }>(
    "POST",
    `/api/private-tutor/golden-candidates/${encodeURIComponent(candidateId)}/reviews`,
    { decision, evidence },
  );
}

export async function evaluatePrivateTutorReleaseGate(input: {
  gateId: string;
  targetId: string;
  status: "passed" | "failed";
  evidence: string;
  evidenceType: PrivateTutorReleaseEvidenceType;
  environment: PrivateTutorReleaseEnvironment;
  artifactName: string;
  artifactChecksumSha256: string;
  executedAt: string;
}) {
  return request<{ evaluation: { id: string; contractVersion: 2; gateId: string; targetId: string; status: "passed" | "failed"; evidence: string; reviewerId: string; executedAt: string; expiresAt: string; evaluatedAt: string }; readiness: PrivateTutorReleaseReadiness }>("POST", "/api/private-tutor/release-readiness/evaluations", input);
}

export async function getPrivateTutorPilot() {
  return request<{ cohorts: PrivateTutorPilotCohort[]; readiness: PrivateTutorReleaseReadiness }>("GET", "/api/private-tutor/pilot");
}

export async function createPrivateTutorPilot(input: { participantTarget: number; responseOwner: string }) {
  const result = await request<{ cohort: PrivateTutorPilotCohort }>("POST", "/api/private-tutor/pilot", input);
  return result.cohort;
}

export async function getPrivateTutorPilotOperations() {
  const result = await request<{ operations: { cohorts: PrivateTutorPilotCohort[]; incidents: PrivateTutorPilotIncident[]; metrics: PrivateTutorPilotMetrics[]; consentDocument: PrivateTutorPilotConsentDocument } }>("GET", "/api/private-tutor/pilot/operations");
  return result.operations;
}

export async function pausePrivateTutorPilot(cohortId: string, reason: string) {
  const result = await request<{ cohort: PrivateTutorPilotCohort }>("POST", `/api/private-tutor/pilot/cohorts/${encodeURIComponent(cohortId)}/pause`, { reason });
  return result.cohort;
}

export async function resumePrivateTutorPilot(cohortId: string, reason: string) {
  const result = await request<{ cohort: PrivateTutorPilotCohort }>("POST", `/api/private-tutor/pilot/cohorts/${encodeURIComponent(cohortId)}/resume`, { reason });
  return result.cohort;
}

export async function updatePrivateTutorPilotIncident(incidentId: string, input: { action: "escalate"; assignedTo?: string } | { action: "resolve"; resolution: string }) {
  const result = await request<{ incident: PrivateTutorPilotIncident }>("POST", `/api/private-tutor/pilot/incidents/${encodeURIComponent(incidentId)}`, input);
  return result.incident;
}

export async function getPrivateTutorGuardianPilot(learnerId: string) {
  const result = await request<{ pilot: PrivateTutorPilotGuardianStatus }>("GET", `/api/private-tutor/learners/${encodeURIComponent(learnerId)}/guardian/pilot`);
  return result.pilot;
}

export async function acceptPrivateTutorPilotConsent(learnerId: string, input: { cohortId: string; consentDocumentId: string; acknowledgements: Record<string, true> }) {
  return request<{ participation: PrivateTutorPilotParticipation }>("POST", `/api/private-tutor/learners/${encodeURIComponent(learnerId)}/guardian/pilot/consent`, input);
}

export async function withdrawPrivateTutorPilot(learnerId: string, input: { reason: "guardian_choice" | "child_choice" | "safety_concern" | "privacy_concern" | "other"; deletionRequested: boolean }) {
  return request<{ participation: PrivateTutorPilotParticipation; deletionRequest: { id: string; status: "pending_parent_confirmation" } | null }>("POST", `/api/private-tutor/learners/${encodeURIComponent(learnerId)}/guardian/pilot/withdraw`, input);
}

export async function recordPrivateTutorPilotCheckIn(learnerId: string, input: { guardianPressure: "low" | "manageable" | "high"; childWillingToReturn: "yes" | "unsure" | "no" }) {
  return request<{ checkIn: PrivateTutorPilotGuardianStatus["checkIns"][number] }>("POST", `/api/private-tutor/learners/${encodeURIComponent(learnerId)}/guardian/pilot/check-ins`, input);
}

export async function reportPrivateTutorPilotIncident(learnerId: string, input: Pick<PrivateTutorPilotIncident, "category" | "summary"> & { needsImmediateStop: boolean }) {
  return request<{ incident: PrivateTutorPilotIncident; cohort: PrivateTutorPilotCohort }>("POST", `/api/private-tutor/learners/${encodeURIComponent(learnerId)}/guardian/pilot/incidents`, input);
}

export async function listPrivateTutorQuestionRevisions() {
  const result = await request<{ revisions: PrivateTutorQuestionRevision[] }>("GET", "/api/private-tutor/content/questions");
  return result.revisions;
}

export async function createPrivateTutorQuestionRevision(input: PrivateTutorQuestionRevisionInput) {
  const result = await request<{ revision: PrivateTutorQuestionRevision }>("POST", "/api/private-tutor/content/questions", input);
  return result.revision;
}

export async function submitPrivateTutorQuestionRevision(revisionId: string) {
  const result = await request<{ revision: PrivateTutorQuestionRevision }>("POST", `/api/private-tutor/content/questions/${encodeURIComponent(revisionId)}/submit`, {});
  return result.revision;
}

export async function reviewPrivateTutorQuestionRevision(revisionId: string, decision: "approved" | "rejected", evidence: string) {
  const result = await request<{ revision: PrivateTutorQuestionRevision }>("POST", `/api/private-tutor/content/questions/${encodeURIComponent(revisionId)}/reviews`, { decision, evidence });
  return result.revision;
}

export async function publishPrivateTutorQuestionRevision(revisionId: string) {
  const result = await request<{ revision: PrivateTutorQuestionRevision }>("POST", `/api/private-tutor/content/questions/${encodeURIComponent(revisionId)}/publish`, {});
  return result.revision;
}

export async function disablePrivateTutorQuestionRevision(revisionId: string, reason: string) {
  const result = await request<{ revision: PrivateTutorQuestionRevision }>("POST", `/api/private-tutor/content/questions/${encodeURIComponent(revisionId)}/disable`, { reason });
  return result.revision;
}

export async function rollbackPrivateTutorQuestion(questionId: string, revisionId: string, reason: string) {
  const result = await request<{ revision: PrivateTutorQuestionRevision }>("POST", `/api/private-tutor/content/questions/${encodeURIComponent(questionId)}/rollback`, { revisionId, reason });
  return result.revision;
}

export async function listPrivateTutorGuardianInvitations(learnerId: string) {
  const result = await request<{ invitations: PrivateTutorGuardianInvitation[] }>("GET", `/api/private-tutor/learners/${encodeURIComponent(learnerId)}/guardian/invitations`);
  return result.invitations;
}

export async function createPrivateTutorGuardianInvitation(learnerId: string, inviteeLabel: string) {
  return request<{ invitation: PrivateTutorGuardianInvitation; invitationToken: string }>("POST", `/api/private-tutor/learners/${encodeURIComponent(learnerId)}/guardian/invitations`, {
    inviteeLabel,
    permissions: ["read", "write", "manage"],
  });
}

export async function acceptPrivateTutorGuardianInvitation(invitationToken: string) {
  return request<{ learner: PrivateTutorLearner }>("POST", "/api/private-tutor/guardian-invitations/accept", { invitationToken });
}

export async function getPrivateTutorDataPolicy() {
  const result = await request<{ policy: PrivateTutorDataPolicy }>("GET", "/api/private-tutor/profile/guardian/data-policy");
  return result.policy;
}

export async function updatePrivateTutorDataPolicy(input: Pick<PrivateTutorDataPolicy, "rawAudioDays" | "voiceTranscriptDays" | "derivedProfileHistoryDays" | "learningEvidenceRetention">) {
  const result = await request<{ policy: PrivateTutorDataPolicy }>("PUT", "/api/private-tutor/profile/guardian/data-policy", input);
  return result.policy;
}

export async function exportPrivateTutorLearnerData() {
  const result = await request<{ bundle: Record<string, unknown> }>("GET", "/api/private-tutor/profile/guardian/data-export");
  return result.bundle;
}

export async function previewPrivateTutorLearnerDeletion() {
  const result = await request<{ preview: PrivateTutorDeletionPreview }>("GET", "/api/private-tutor/profile/guardian/deletion-preview");
  return result.preview;
}

/** @deprecated 旧家庭多孩子模型兼容面；M1 删除走 deletePrivateTutorProfile。 */
export async function deletePrivateTutorLearner(learnerId: string, confirmDisplayName: string) {
  return request<{ deletedId: string; deletionReport: { id: string; liveStateResidualCount: number; durableVerification: { backing: "sqlite" | "json" | "memory"; durableResidualCount: number; secureDelete: boolean; walCheckpointed: boolean; checkpointBusy: number | null; remainingLogFrames: number | null; logicalPersistenceSucceeded: boolean; jsonRollbackArtifactUpdated: boolean; reportPersisted: boolean; compactionError: string | null; ok: boolean } } }>("DELETE", `/api/private-tutor/learners/${encodeURIComponent(learnerId)}`, { confirmDisplayName });
}

export async function retryPrivateTutorLearnerDeletion(reportId: string) {
  return request<{ deletedId: null; deletionReport: { id: string; liveStateResidualCount: number; durableVerification: { ok: boolean } }; replayed: boolean }>("POST", `/api/private-tutor/deletions/${encodeURIComponent(reportId)}/retry`);
}

export async function listPrivateTutorDeletionJobs() {
  const result = await request<{ deletions: PrivateTutorDeletionJobStatus[] }>("GET", "/api/private-tutor/deletions");
  return result.deletions;
}
