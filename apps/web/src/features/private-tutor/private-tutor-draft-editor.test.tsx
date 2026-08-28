import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrivateTutorDraftEditor } from "@/features/private-tutor/components/private-tutor-draft-editor";
import type { AuthoredContentVersion, KnowledgeMapDraft, MaterialDocument } from "@/features/private-tutor/private-tutor-api";

const apiMocks = vi.hoisted(() => ({
  update: vi.fn(),
  confirm: vi.fn(),
  author: vi.fn(),
  updateContent: vi.fn(),
  confirmContent: vi.fn(),
  publish: vi.fn(),
}));

vi.mock("@/features/private-tutor/private-tutor-api", () => ({
  updatePrivateTutorKnowledgeMapDraft: apiMocks.update,
  confirmPrivateTutorKnowledgeMapDraft: apiMocks.confirm,
  generatePrivateTutorAuthoredContent: apiMocks.author,
  updatePrivateTutorAuthoredContent: apiMocks.updateContent,
  confirmPrivateTutorAuthoredContent: apiMocks.confirmContent,
  publishPrivateTutorKnowledgeMapDraft: apiMocks.publish,
}));

const sourceRef = {
  sourceHash: "hash_book",
  sectionId: "sec_1",
  pageNumber: 3,
  excerpt: "这一节解释概念一和概念二。",
  origin: "source" as const,
};

const material: MaterialDocument = {
  id: "mat_book",
  learningProfileId: "learner_1",
  fileName: "book.pdf",
  fileType: "pdf",
  fileSize: 1024,
  sourceHash: "hash_book",
  status: "parsed",
  sections: [{
    id: "sec_1",
    title: "第一节",
    level: 2,
    pageNumber: 3,
    lineStart: 1,
    lineEnd: 2,
    content: sourceRef.excerpt,
  }],
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
};

const initialDraft: KnowledgeMapDraft = {
  id: "kmd_book",
  materialDocumentId: material.id,
  learningProfileId: material.learningProfileId,
  packageName: "教材学习包",
  subjectId: "general",
  domain: "general",
  schemaVersion: 2,
  revision: 1,
  sourceSnapshot: {
    materialDocumentId: material.id,
    sourceHash: material.sourceHash,
    parserVersion: 2,
    sectionCount: 1,
    pageCount: 3,
  },
  draftModules: [{ id: "mod_1", name: "模块一", description: "简介", orderIndex: 1, sourceRef }],
  draftTopics: [{ id: "top_1", moduleId: "mod_1", name: "主题一", description: "简介", orderIndex: 1, sourceRef }],
  draftKnowledgeComponents: [
    {
      id: "kc_1",
      topicId: "top_1",
      name: "概念一",
      shortDescription: "概念一说明",
      learningObjectives: ["解释概念一", "应用概念一"],
      prerequisiteDraftIds: [],
      sourceRef,
      sourceRefs: [sourceRef],
      candidateQuestions: [],
      orderIndex: 1,
    },
    {
      id: "kc_2",
      topicId: "top_1",
      name: "概念二",
      shortDescription: "概念二说明",
      learningObjectives: ["解释概念二"],
      prerequisiteDraftIds: ["kc_1"],
      sourceRef,
      sourceRefs: [sourceRef],
      candidateQuestions: [],
      orderIndex: 2,
    },
  ],
  validationIssues: [],
  confirmation: null,
  authoredContentVersions: [],
  activeAuthoredContentVersion: null,
  status: "in_review",
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
};

const confirmedDraft: KnowledgeMapDraft = {
  ...initialDraft,
  revision: 2,
  status: "confirmed",
  confirmation: {
    revision: 2,
    fingerprint: "map_fingerprint",
    confirmedBy: "user_1",
    confirmedAt: "2026-08-26T00:01:00.000Z",
    acknowledgement: "source_map_reviewed",
  },
};

const rubric = {
  version: "2.0.0",
  profile: "anchored-concept-rubric-v2" as const,
  passBand: "proficient",
  reviewThreshold: 0.75,
  sourceWeight: 0.15,
  requiredSourceRefs: ["sec_1"],
  availableSourceRefs: ["sec_1"],
  bands: [{ id: "insufficient", minScore: 0, maxScore: 0.49 }, { id: "developing", minScore: 0.5, maxScore: 0.89 }, { id: "proficient", minScore: 0.9, maxScore: 1 }],
  anchors: [
    { id: "a1", band: "insufficient", description: "缺少核心内容", sample: "还不能解释" },
    { id: "a2", band: "developing", description: "覆盖部分内容", sample: "[ref:sec_1] 概念一" },
    { id: "a3", band: "proficient", description: "内容与来源完整", sample: "[ref:sec_1] 这一节解释概念一和概念二。" },
  ],
  criteria: [{ id: "concept", label: "核心概念", weight: 0.85, acceptedPhrases: ["概念一"], partialPhrases: [], sourceRef: "sec_1" }],
};

const question = {
  id: "kc_1-practice-1-v1",
  questionId: "kc_1-practice-1",
  knowledgeId: "kc_1",
  context: "practice" as const,
  difficulty: 2,
  kind: "rubric_response" as const,
  prompt: "解释概念一并使用 [ref:sec_1] 标明依据。",
  referenceAnswer: sourceRef.excerpt,
  requiredSourceRefs: ["sec_1"],
  sourceRefs: [sourceRef],
  rubric,
  evidencePolicy: "practice_only_until_runtime_validation" as const,
  provenance: "rule_extracted" as const,
};

const authoredContent: AuthoredContentVersion = {
  id: "kmd_book_content_v1",
  draftId: initialDraft.id,
  learningProfileId: initialDraft.learningProfileId,
  schemaVersion: 1,
  generatorVersion: "source-template-v1",
  version: 1,
  revision: 1,
  sourceMapRevision: 2,
  sourceMapFingerprint: "map_fingerprint",
  status: "in_review",
  knowledgeContents: [{
    knowledgeId: "kc_1",
    sourceRefs: [sourceRef],
    teachingContent: {
      coreConcept: "概念一",
      explanation: sourceRef.excerpt,
      provenance: "source_excerpt",
      guidance: "先阅读原文，再用自己的话解释。",
      guidanceProvenance: "rule_extracted",
      keyPoints: ["解释概念一"],
      hints: ["先定位来源"],
      methods: { default: "source-read-explain-apply-review" },
    },
    diagnosticQuestions: [{ ...question, id: "kc_1-diagnostic-1-v1", questionId: "kc_1-diagnostic-1", context: "diagnostic" }],
    tutoringQuestions: [
      { ...question, id: "kc_1-tutoring-1-v1", questionId: "kc_1-tutoring-1", context: "tutoring" },
      { ...question, id: "kc_1-tutoring-2-v1", questionId: "kc_1-tutoring-2", context: "tutoring" },
      { ...question, id: "kc_1-tutoring-3-v1", questionId: "kc_1-tutoring-3", context: "tutoring" },
    ],
    dailyQuestions: [question],
    reviewQuestions: [{ ...question, id: "kc_1-review-1-v1", questionId: "kc_1-review-1", context: "review" }],
  }],
  validationIssues: [],
  confirmation: null,
  generatedBy: "user_1",
  generatedAt: "2026-08-26T00:02:00.000Z",
  updatedAt: "2026-08-26T00:02:00.000Z",
};

describe("private tutor source-grounded draft editor", () => {
  beforeEach(() => {
    apiMocks.update.mockImplementation(async (_id: string, patch: Partial<KnowledgeMapDraft>) => ({
      ...initialDraft,
      ...patch,
      revision: 2,
      status: "in_review" as const,
      confirmation: null,
    }));
    apiMocks.confirm.mockResolvedValue(confirmedDraft);
    apiMocks.author.mockResolvedValue({
      draft: { ...confirmedDraft, status: "content_in_review", authoredContentVersions: [authoredContent], activeAuthoredContentVersion: 1 },
      authoredContent,
    });
    apiMocks.updateContent.mockImplementation(async (_id: string, input: { knowledgeContents: AuthoredContentVersion["knowledgeContents"] }) => {
      const savedContent = { ...authoredContent, revision: 2, knowledgeContents: input.knowledgeContents };
      return {
        draft: { ...confirmedDraft, status: "content_in_review", authoredContentVersions: [savedContent], activeAuthoredContentVersion: 1 },
        authoredContent: savedContent,
      };
    });
    const confirmedContent = {
      ...authoredContent,
      revision: 2,
      status: "confirmed" as const,
      confirmation: {
        revision: 2,
        fingerprint: "content_fingerprint",
        confirmedBy: "user_1",
        confirmedAt: "2026-08-26T00:03:00.000Z",
        acknowledgement: "teaching_content_and_rubrics_reviewed" as const,
      },
    };
    apiMocks.confirmContent.mockResolvedValue({
      draft: { ...confirmedDraft, status: "content_confirmed", authoredContentVersions: [confirmedContent], activeAuthoredContentVersion: 1 },
      authoredContent: confirmedContent,
    });
    apiMocks.publish.mockResolvedValue({ success: true, packageId: "pkg_book" });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("requires map and authored-content confirmation, then invalidates both on a later edit", async () => {
    render(<PrivateTutorDraftEditor material={material} draft={initialDraft} onClose={vi.fn()} onPublished={vi.fn()} />);
    const publish = screen.getByRole("button", { name: "发布为学习内容包" }) as HTMLButtonElement;
    expect(publish.disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "确认来源与结构" }));
    await waitFor(() => expect(apiMocks.confirm).toHaveBeenCalledWith(initialDraft.id, {
      expectedRevision: 2,
      acknowledgeSourceReview: true,
    }));
    expect((screen.getByRole("button", { name: "发布为学习内容包" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "生成教学内容" }));
    await waitFor(() => expect(apiMocks.author).toHaveBeenCalledWith(initialDraft.id, { forceRegenerate: false }));
    expect((screen.getByRole("button", { name: "发布为学习内容包" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "确认教学内容" }));
    await waitFor(() => expect(apiMocks.confirmContent).toHaveBeenCalledWith(initialDraft.id, {
      expectedRevision: 2,
      acknowledgeContentReview: true,
    }));
    expect((screen.getByRole("button", { name: "发布为学习内容包" }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.change(screen.getByLabelText("内容包名称"), { target: { value: "重新编辑的学习包" } });
    expect((screen.getByRole("button", { name: "发布为学习内容包" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows source-constrained explanations, exercises, reference answers, and score anchors", () => {
    const contentDraft = { ...confirmedDraft, status: "content_in_review" as const, authoredContentVersions: [authoredContent], activeAuthoredContentVersion: 1 };
    render(<PrivateTutorDraftEditor material={material} draft={contentDraft} onClose={vi.fn()} onPublished={vi.fn()} />);
    fireEvent.click(screen.getByText("概念一"));
    expect(screen.getByText("教学内容复核 · v1")).toBeTruthy();
    expect((screen.getByLabelText("原文讲解") as HTMLTextAreaElement).value).toBe(sourceRef.excerpt);
    expect((screen.getByLabelText("独立练习题目") as HTMLTextAreaElement).value).toBe(question.prompt);
    expect(screen.getByText("评分锚点")).toBeTruthy();
    expect(screen.getByText(/M7.4 运行时验证前/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("学习引导"), { target: { value: "先核对原文，再解释。" } });
    fireEvent.click(screen.getByRole("button", { name: "保存教学内容" }));
    expect(apiMocks.updateContent).toHaveBeenCalledWith(initialDraft.id, {
      knowledgeContents: expect.arrayContaining([
        expect.objectContaining({ teachingContent: expect.objectContaining({ guidance: "先核对原文，再解释。" }) }),
      ]),
    });
  });

  it("shows automatic unit aggregation and the math evaluator contract", () => {
    const mathQuestion = {
      ...question,
      kind: "numeric" as const,
      prompt: "计算 125×8 = ?（依据 [ref:sec_1]）",
      expectedAnswer: "1000",
      referenceAnswer: undefined,
      rubric: undefined,
      provenance: "source_math_expression" as const,
    };
    const mathContent = {
      ...authoredContent,
      knowledgeContents: [{
        ...authoredContent.knowledgeContents[0],
        dailyQuestions: [mathQuestion],
      }],
    };
    const mathDraft: KnowledgeMapDraft = {
      ...confirmedDraft,
      subjectId: "math",
      evaluationSubjectId: "math",
      subjectDetection: {
        requestedSubjectId: "general", resolvedSubjectId: "math", evaluationSubjectId: "math",
        confidence: 0.95, mode: "automatic", signals: ["math_filename"],
      },
      aggregation: { strategy: "textbook_units_v1", sourceSectionCount: 8, detectedUnitCount: 2, moduleCount: 2 },
      status: "content_in_review",
      authoredContentVersions: [mathContent],
      activeAuthoredContentVersion: 1,
    };
    render(<PrivateTutorDraftEditor material={material} draft={mathDraft} onClose={vi.fn()} onPublished={vi.fn()} />);
    expect(screen.getByText(/自动识别：数学 · math 评测器 · 按 2 个单元合并/)).toBeTruthy();
    fireEvent.click(screen.getByText("概念一"));
    expect(screen.getByText("数学专用评测 · numeric")).toBeTruthy();
    expect((screen.getByLabelText("数学确定性答案") as HTMLInputElement).value).toBe("1000");
    expect(screen.queryByText("评分锚点")).toBeNull();
  });

  it("splits a knowledge component while preserving source evidence", async () => {
    render(<PrivateTutorDraftEditor material={material} draft={initialDraft} onClose={vi.fn()} onPublished={vi.fn()} />);
    fireEvent.click(screen.getByText("概念一"));
    expect(screen.getByText("原文对照 (第 3 页)")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "拆分" }));
    await waitFor(() => expect(apiMocks.update).toHaveBeenCalled());
    const update = apiMocks.update.mock.calls.at(-1)?.[1] as Partial<KnowledgeMapDraft>;
    expect(update.draftKnowledgeComponents).toHaveLength(3);
    expect(update.draftKnowledgeComponents?.[0].sourceRefs).toEqual([sourceRef]);
    expect(update.draftKnowledgeComponents?.[1].prerequisiteDraftIds).toEqual(["kc_1"]);
  });
});
