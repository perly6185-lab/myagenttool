import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrivateTutorDraftEditor } from "@/features/private-tutor/components/private-tutor-draft-editor";
import type { KnowledgeMapDraft, MaterialDocument } from "@/features/private-tutor/private-tutor-api";

const apiMocks = vi.hoisted(() => ({
  update: vi.fn(),
  confirm: vi.fn(),
  publish: vi.fn(),
}));

vi.mock("@/features/private-tutor/private-tutor-api", () => ({
  updatePrivateTutorKnowledgeMapDraft: apiMocks.update,
  confirmPrivateTutorKnowledgeMapDraft: apiMocks.confirm,
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
  status: "in_review",
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
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
    apiMocks.confirm.mockImplementation(async () => ({
      ...initialDraft,
      revision: 2,
      status: "confirmed" as const,
      confirmation: {
        revision: 2,
        fingerprint: "fingerprint",
        confirmedBy: "user_1",
        confirmedAt: "2026-08-26T00:01:00.000Z",
        acknowledgement: "source_map_reviewed" as const,
      },
    }));
    apiMocks.publish.mockResolvedValue({ success: true, packageId: "pkg_book" });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("requires revision-bound source confirmation and invalidates it on a later edit", async () => {
    render(<PrivateTutorDraftEditor material={material} draft={initialDraft} onClose={vi.fn()} onPublished={vi.fn()} />);
    const publish = screen.getByRole("button", { name: "发布为学习内容包" }) as HTMLButtonElement;
    expect(publish.disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "确认来源与结构" }));
    await waitFor(() => expect(apiMocks.confirm).toHaveBeenCalledWith(initialDraft.id, {
      expectedRevision: 2,
      acknowledgeSourceReview: true,
    }));
    expect((screen.getByRole("button", { name: "发布为学习内容包" }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.change(screen.getByLabelText("内容包名称"), { target: { value: "重新编辑的学习包" } });
    expect((screen.getByRole("button", { name: "发布为学习内容包" }) as HTMLButtonElement).disabled).toBe(true);
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
