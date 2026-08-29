import { parseRationalAnswer, rationalToJSON } from "../plugins/math-plugin.mjs";

export const ORIGINAL_CURRICULUM_LICENSE = "MyAgentTool-Original-Content-v1";
export const ORIGINAL_CURRICULUM_NOTICE = "依据义务教育数学课程标准（2022年版）独立编写，非出版社官方教材或教辅。可由学习者在本地导入其合法持有的教材进行个人进度对齐。";

export function numericQuestion(id, knowledgeId, difficulty, prompt, expected, options = {}) {
  const rational = parseRationalAnswer(expected);
  if (!rational) throw new Error(`invalid_original_math_answer:${id}`);
  return {
    id,
    questionId: questionIdFromRevisionId(id),
    knowledgeId,
    difficulty,
    prompt,
    kind: "numeric",
    expectedAnswer: expected,
    expectedRational: rationalToJSON(rational),
    ...options,
  };
}

export function choiceQuestion(id, knowledgeId, difficulty, prompt, options, expectedChoice) {
  if (!Array.isArray(options) || options.length < 2 || !options.some((option) => option.id === expectedChoice)) {
    throw new Error(`invalid_original_math_choice:${id}`);
  }
  return {
    id,
    questionId: questionIdFromRevisionId(id),
    knowledgeId,
    difficulty,
    prompt,
    kind: "choice",
    options,
    expectedChoice,
  };
}

export function curriculumKnowledge({
  id,
  name,
  shortDescription,
  topicId,
  orderIndex,
  prerequisites = [],
  downstreamImpact = 1,
  objectives,
  misconceptions,
  coreConcept,
  keyPoints,
  diagnostic,
  practice,
  tutoring,
  review,
}) {
  if (!diagnostic?.length || !practice?.length || tutoring?.length < 3 || !review?.length) {
    throw new Error(`incomplete_original_math_question_bank:${id}`);
  }
  return {
    id,
    name,
    shortDescription,
    topicId,
    orderIndex,
    prerequisiteKnowledgeIds: prerequisites,
    downstreamImpact,
    learningObjectives: objectives,
    misconceptions,
    teachingContent: {
      questionPrefix: id,
      coreConcept,
      keyPoints,
    },
    diagnosticQuestions: diagnostic,
    dailyQuestions: practice,
    tutoringQuestions: tutoring,
    reviewQuestions: review,
  };
}

export function curriculumMetadata({ grade, semester, editionYear }) {
  return {
    curriculumStandardVersion: "2022",
    curriculumReference: {
      title: "义务教育数学课程标准（2022年版）",
      url: "https://www.moe.gov.cn/srcsite/A26/s8001/202204/W020220420582346895190.pdf",
    },
    publisherAlignment: {
      status: "none",
      publisher: null,
      edition: null,
    },
    editionYear,
    grade,
    semester,
    rightsStatus: "original",
    officialPublisherProduct: false,
    contentNotice: ORIGINAL_CURRICULUM_NOTICE,
    supersedesPackageId: null,
  };
}

function questionIdFromRevisionId(revisionId) {
  return revisionId.replace(/-v\d+$/, "");
}
