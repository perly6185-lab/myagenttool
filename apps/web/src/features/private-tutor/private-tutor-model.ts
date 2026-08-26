export type ContentSourceType = "textbook" | "university_course" | "professional_skill" | "user_material";

export interface EvaluationCapabilities {
  deterministicGrading: boolean;
  stepEvaluation: boolean;
  speechEvaluation: boolean;
  visualInteractions: boolean;
  semanticEvaluation?: boolean | "authored_rubric" | "source_grounded_rubric" | "causal-semantic-v2" | "anchored-concept-rubric-v2";
  codeExecution?: boolean;
  sourceGrounding?: boolean;
}

export interface ContentTargetAudience {
  stage?: string;
  description?: string;
  prerequisites?: string[];
}

export interface LearningContentPackage {
  id: string;
  name: string;
  subjectId: string;
  domain: string;
  sourceType: ContentSourceType;
  version: string;
  license: string;
  targetAudience?: ContentTargetAudience;
  evaluationCapabilities?: EvaluationCapabilities;
  modules?: Module[];
  knowledgeComponents?: KnowledgeComponentSummary[];
}

export interface MaterialSection {
  id: string;
  title: string;
  level: number;
  pageNumber: number | null;
  lineStart: number;
  lineEnd: number;
  content: string;
}

export interface MaterialPage {
  pageNumber: number;
  text: string;
  characterCount: number;
  source: "pdf_text" | "local_ocr";
  confidence: number | null;
}

export interface MaterialExtractionWarning {
  code: string;
  detail?: string;
  pageNumbers?: number[];
  limit?: number;
}

export interface MaterialExtraction {
  parserVersion: number;
  state: "ready" | "needs_ocr" | "empty";
  method: "native_text" | "pdf_text" | "pdf_text_with_local_ocr" | "legacy_extracted_pdf_text";
  pageCount: number | null;
  processedPageCount: number | null;
  characterCount: number;
  textPageCount: number | null;
  lowTextPageNumbers: number[];
  truncated: boolean;
  truncatedPages: boolean;
  needsOcr: boolean;
  ocr: {
    required: boolean;
    attempted: boolean;
    state: "not_required" | "unavailable" | "completed" | "failed";
    providerId: string | null;
    reason: string | null;
  };
  warnings: MaterialExtractionWarning[];
}

export interface MaterialDocument {
  id: string;
  learningProfileId: string;
  fileName: string;
  fileType: "markdown" | "pdf" | "plain_text";
  fileSize: number;
  sourceHash: string;
  status: "uploaded" | "parsing" | "parsed" | "needs_ocr" | "draft_ready" | "published" | "failed" | "empty";
  rawText?: string;
  pages?: MaterialPage[];
  sections: MaterialSection[];
  extraction?: MaterialExtraction;
  createdAt: string;
  updatedAt: string;
}

export interface DraftSourceRef {
  sectionId: string;
  pageNumber: number | null;
  excerpt: string;
}

export interface DraftCandidateQuestion {
  id: string;
  prompt: string;
  kind: string;
}

export interface DraftModule {
  id: string;
  name: string;
  description: string;
  sourceSectionId?: string;
  orderIndex: number;
}

export interface DraftTopic {
  id: string;
  moduleId: string;
  name: string;
  description: string;
  sourceSectionId?: string;
  orderIndex: number;
}

export interface DraftKnowledgeComponent {
  id: string;
  topicId: string;
  name: string;
  shortDescription?: string;
  learningObjectives: string[];
  prerequisiteDraftIds: string[];
  sourceRef?: DraftSourceRef;
  candidateQuestions?: DraftCandidateQuestion[];
  orderIndex: number;
}

export interface DraftValidationIssue {
  type: "cycle" | "missing_prerequisite" | string;
  message: string;
  severity: "error" | "warning" | "info";
}

export interface KnowledgeMapDraft {
  id: string;
  materialDocumentId: string;
  learningProfileId: string;
  packageName: string;
  subjectId: string;
  domain: string;
  schemaVersion: number;
  draftModules: DraftModule[];
  draftTopics: DraftTopic[];
  draftKnowledgeComponents: DraftKnowledgeComponent[];
  validationIssues: DraftValidationIssue[];
  status: "in_review" | "published" | "discarded";
  publishedPackageId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Module {
  id: string;
  packageId?: string;
  name: string;
  description: string;
  orderIndex: number;
  topics?: Topic[];
}

export interface Topic {
  id: string;
  moduleId?: string;
  packageId?: string;
  name: string;
  description: string;
  orderIndex: number;
  knowledgeComponentIds?: string[];
}

export interface KnowledgeComponentSummary {
  id: string;
  packageId?: string;
  topicId?: string;
  name: string;
  shortDescription?: string;
  orderIndex?: number;
  prerequisiteKnowledgeIds?: string[];
  downstreamImpact?: number;
  learningObjectives?: string[];
  misconceptions?: Array<{ id: string; label: string; recommendedStrategy?: string }>;
}

export interface KnowledgeGraphData {
  packageId: string;
  packageName: string;
  version: string;
  subjectId: string;
  nodes: Array<{
    id: string;
    name: string;
    topicId?: string;
    topicName?: string;
    moduleName?: string;
    orderIndex?: number;
    prerequisites: string[];
    downstreamImpact: number;
    learningObjectives: string[];
  }>;
  topologicalOrder: string[];
}

export type TutorTab = "today" | "map" | "errors" | "growth" | "settings";

export type TutorSettingsSpace = "preferences" | "content" | "teacher" | "data";

export type MasteryLevel = "mastered" | "learning" | "needs_support" | "unknown";

export type TeachingStrategy =
  | "prerequisite_repair"
  | "concept_rebuild"
  | "fluency_practice"
  | "transfer_challenge";

export interface LearnerProfile {
  id: string;
  displayName: string;
  grade: string;
  curriculum: string;
  avatar: string;
}

export interface KnowledgeNode {
  id: string;
  title: string;
  mastery: number | null;
  level: MasteryLevel;
  evidence: string;
}

export interface ErrorCase {
  id: string;
  learnerId: string;
  knowledgeId: string;
  title: string;
  misconception: string;
  status: "challenge_today" | "working" | "mastered";
  nextReview: string;
  strategy: TeachingStrategy;
}

export interface LearnerTutorState {
  learner: LearnerProfile;
  dailyMinutes: number;
  streakDays: number;
  completedSessions: number;
  independentAnswers: number;
  knowledge: KnowledgeNode[];
  errors: ErrorCase[];
}

const KNOWLEDGE_TEMPLATE: KnowledgeNode[] = [
  { id: "integer", title: "有理数运算", mastery: 0.86, level: "mastered", evidence: "3 次独立答对" },
  { id: "equation-meaning", title: "等式与方程", mastery: 0.68, level: "learning", evidence: "会列式，移项含义待巩固" },
  { id: "balance", title: "等式两边同乘同除", mastery: 0.42, level: "needs_support", evidence: "2 次忘记同时处理等式两边" },
  { id: "word-problem", title: "一元一次方程应用", mastery: null, level: "unknown", evidence: "尚未测到" },
];

export function createInitialLearnerState(learner: LearnerProfile): LearnerTutorState {
  const knowledge = KNOWLEDGE_TEMPLATE.map((node) => ({ ...node }));
  return {
    learner,
    dailyMinutes: 6,
    streakDays: 3,
    completedSessions: 6,
    independentAnswers: 17,
    knowledge,
    errors: [
      {
        id: `${learner.id}-balance-sign`,
        learnerId: learner.id,
        knowledgeId: "balance",
        title: "等式两边要做同样的事",
        misconception: "只处理了等式的一边",
        status: "challenge_today",
        nextReview: "今天",
        strategy: "concept_rebuild",
      },
      {
        id: `${learner.id}-negative-number`,
        learnerId: learner.id,
        knowledgeId: "integer",
        title: "负数减法",
        misconception: "把减去负数当成继续相减",
        status: "mastered",
        nextReview: "3 天后复测",
        strategy: "transfer_challenge",
      },
    ],
  };
}

export function strategyLabel(strategy: TeachingStrategy) {
  return {
    prerequisite_repair: "回到前置知识",
    concept_rebuild: "用天平重新理解",
    fluency_practice: "短组流畅度练习",
    transfer_challenge: "换一道新题验证",
  }[strategy];
}

export function completeIndependentCheck(state: LearnerTutorState): LearnerTutorState {
  return {
    ...state,
    dailyMinutes: Math.min(20, state.dailyMinutes + 4),
    independentAnswers: state.independentAnswers + 1,
    knowledge: state.knowledge.map((node) => node.id === "balance"
      ? {
          ...node,
          mastery: Math.min(1, (node.mastery ?? 0) + 0.12),
          level: "learning",
          evidence: "刚刚独立答对一题，等待延迟复测",
        }
      : node),
    errors: state.errors.map((item) => item.knowledgeId === "balance"
      ? { ...item, status: "working", nextReview: "明天" }
      : item),
  };
}

export function assertLearnerBoundary(state: LearnerTutorState, learnerId: string) {
  return state.learner.id === learnerId && state.errors.every((item) => item.learnerId === learnerId);
}
