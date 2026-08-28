import { describe, expect, it, vi } from "vitest";
import {
  listPrivateTutorMaterials,
  uploadPrivateTutorMaterial,
  getPrivateTutorMaterial,
  deletePrivateTutorMaterial,
  startPrivateTutorMaterialOcr,
  listPrivateTutorMaterialOcrJobs,
  getPrivateTutorOcrJob,
  retryPrivateTutorOcrJob,
  cancelPrivateTutorOcrJob,
  generatePrivateTutorKnowledgeMapDraft,
  getPrivateTutorKnowledgeMapDraft,
  updatePrivateTutorKnowledgeMapDraft,
  confirmPrivateTutorKnowledgeMapDraft,
  generatePrivateTutorAuthoredContent,
  updatePrivateTutorAuthoredContent,
  confirmPrivateTutorAuthoredContent,
  publishPrivateTutorKnowledgeMapDraft,
  activatePrivateTutorContentPackage,
  getPrivateTutorLearningHistory,
  getPrivateTutorLearningTrial,
  startPrivateTutorLearningTrial,
  stopPrivateTutorLearningTrial,
} from "@/features/private-tutor/private-tutor-api";
import * as apiRequest from "@/lib/api/request";

const fakeMaterial = {
  id: "mat_abc123",
  learningProfileId: "learner_xyz",
  fileName: "notes.md",
  fileType: "markdown" as const,
  fileSize: 256,
  sourceHash: "deadbeef",
  status: "parsed" as const,
  sections: [
    { id: "sec_1", title: "Intro", level: 1, pageNumber: 1, lineStart: 1, lineEnd: 5, content: "Hello world" },
  ],
  createdAt: "2026-08-25T00:00:00.000Z",
  updatedAt: "2026-08-25T00:00:00.000Z",
};

const fakeDraft = {
  id: "kmd_xyz789",
  materialDocumentId: "mat_abc123",
  learningProfileId: "learner_xyz",
  packageName: "Test Package",
  subjectId: "general",
  domain: "general",
  schemaVersion: 1,
  revision: 1,
  sourceSnapshot: { materialDocumentId: "mat_abc123", sourceHash: "deadbeef", parserVersion: 2, sectionCount: 1, pageCount: 1 },
  draftModules: [
    { id: "mod_1", name: "Module 1", description: "d", orderIndex: 1 },
  ],
  draftTopics: [
    { id: "top_1", moduleId: "mod_1", name: "Topic 1", description: "d", orderIndex: 1 },
  ],
  draftKnowledgeComponents: [
    { id: "kc_1", topicId: "top_1", name: "KC 1", learningObjectives: ["goal"], prerequisiteDraftIds: [], orderIndex: 1 },
  ],
  validationIssues: [],
  confirmation: null,
  authoredContentVersions: [],
  activeAuthoredContentVersion: null,
  status: "in_review" as const,
  createdAt: "2026-08-25T00:00:00.000Z",
  updatedAt: "2026-08-25T00:00:00.000Z",
};

describe("private tutor material import & draft API", () => {
  it("listPrivateTutorMaterials calls GET /api/private-tutor/materials", async () => {
    const spy = vi.spyOn(apiRequest, "request").mockResolvedValueOnce({ materials: [fakeMaterial] });
    const materials = await listPrivateTutorMaterials();
    expect(materials).toEqual([fakeMaterial]);
    expect(spy).toHaveBeenCalledWith("GET", "/api/private-tutor/materials");
  });

  it("uploadPrivateTutorMaterial posts to /api/private-tutor/materials", async () => {
    const spy = vi.spyOn(apiRequest, "request").mockResolvedValueOnce({ material: fakeMaterial });
    const material = await uploadPrivateTutorMaterial({
      fileName: "notes.md",
      fileType: "markdown",
      fileContent: "# Heading",
      fileSize: 10,
    });
    expect(material).toEqual(fakeMaterial);
    expect(spy).toHaveBeenCalledWith("POST", "/api/private-tutor/materials", {
      fileName: "notes.md",
      fileType: "markdown",
      fileContent: "# Heading",
      fileSize: 10,
    });
  });

  it("getPrivateTutorMaterial encodes materialId", async () => {
    const spy = vi.spyOn(apiRequest, "request").mockResolvedValueOnce({ material: fakeMaterial });
    await getPrivateTutorMaterial("mat/special id");
    expect(spy).toHaveBeenCalledWith("GET", "/api/private-tutor/materials/mat%2Fspecial%20id");
  });

  it("deletePrivateTutorMaterial issues DELETE on material", async () => {
    const spy = vi.spyOn(apiRequest, "request").mockResolvedValueOnce({ deleted: true });
    const res = await deletePrivateTutorMaterial("mat_abc123");
    expect(res).toEqual({ deleted: true });
    expect(spy).toHaveBeenCalledWith("DELETE", "/api/private-tutor/materials/mat_abc123");
  });

  it("uses the resumable OCR job endpoints", async () => {
    const job = { id: "ptocr_1", materialId: "mat_abc123", status: "queued" };
    const spy = vi.spyOn(apiRequest, "request")
      .mockResolvedValueOnce({ job, replayed: false })
      .mockResolvedValueOnce({ jobs: [job] })
      .mockResolvedValueOnce({ job, material: fakeMaterial })
      .mockResolvedValueOnce({ job })
      .mockResolvedValueOnce({ job: { ...job, status: "cancelled" } });
    await startPrivateTutorMaterialOcr("mat_abc123", { cloudAllowed: true });
    await listPrivateTutorMaterialOcrJobs("mat_abc123");
    await getPrivateTutorOcrJob("ptocr_1");
    await retryPrivateTutorOcrJob("ptocr_1", { cloudAllowed: true });
    await cancelPrivateTutorOcrJob("ptocr_1");
    expect(spy.mock.calls).toEqual([
      ["POST", "/api/private-tutor/materials/mat_abc123/ocr-jobs", { cloudAllowed: true }],
      ["GET", "/api/private-tutor/materials/mat_abc123/ocr-jobs"],
      ["GET", "/api/private-tutor/ocr-jobs/ptocr_1"],
      ["POST", "/api/private-tutor/ocr-jobs/ptocr_1/retry", { cloudAllowed: true }],
      ["POST", "/api/private-tutor/ocr-jobs/ptocr_1/cancel", {}],
    ]);
  });

  it("generatePrivateTutorKnowledgeMapDraft calls generate-draft endpoint", async () => {
    const spy = vi.spyOn(apiRequest, "request").mockResolvedValueOnce({ draft: fakeDraft });
    const draft = await generatePrivateTutorKnowledgeMapDraft("mat_abc123", { packageName: "Custom" });
    expect(draft).toEqual(fakeDraft);
    expect(spy).toHaveBeenCalledWith("POST", "/api/private-tutor/materials/mat_abc123/generate-draft", { packageName: "Custom" });
  });

  it("getPrivateTutorKnowledgeMapDraft issues GET", async () => {
    const spy = vi.spyOn(apiRequest, "request").mockResolvedValueOnce({ draft: fakeDraft });
    await getPrivateTutorKnowledgeMapDraft("kmd_xyz789");
    expect(spy).toHaveBeenCalledWith("GET", "/api/private-tutor/knowledge-map-drafts/kmd_xyz789");
  });

  it("updatePrivateTutorKnowledgeMapDraft issues PUT", async () => {
    const spy = vi.spyOn(apiRequest, "request").mockResolvedValueOnce({ draft: fakeDraft });
    await updatePrivateTutorKnowledgeMapDraft("kmd_xyz789", { packageName: "Renamed" });
    expect(spy).toHaveBeenCalledWith("PUT", "/api/private-tutor/knowledge-map-drafts/kmd_xyz789", { packageName: "Renamed" });
  });

  it("confirmPrivateTutorKnowledgeMapDraft sends revision-bound source acknowledgement", async () => {
    const confirmedDraft = { ...fakeDraft, status: "confirmed" as const };
    const spy = vi.spyOn(apiRequest, "request").mockResolvedValueOnce({ draft: confirmedDraft });
    const result = await confirmPrivateTutorKnowledgeMapDraft("kmd_xyz789", {
      expectedRevision: 3,
      acknowledgeSourceReview: true,
    });
    expect(result).toEqual(confirmedDraft);
    expect(spy).toHaveBeenCalledWith("POST", "/api/private-tutor/knowledge-map-drafts/kmd_xyz789/confirm", {
      expectedRevision: 3,
      acknowledgeSourceReview: true,
    });
  });

  it("generatePrivateTutorAuthoredContent requests a source-grounded content version", async () => {
    const authoredContent = { id: "kmd_xyz789_content_v1", version: 1, revision: 1 };
    const spy = vi.spyOn(apiRequest, "request").mockResolvedValueOnce({ draft: fakeDraft, authoredContent });
    await generatePrivateTutorAuthoredContent("kmd_xyz789", { forceRegenerate: true });
    expect(spy).toHaveBeenCalledWith("POST", "/api/private-tutor/knowledge-map-drafts/kmd_xyz789/author-content", { forceRegenerate: true });
  });

  it("updatePrivateTutorAuthoredContent saves the current content revision", async () => {
    const authoredContent = { id: "kmd_xyz789_content_v1", version: 1, revision: 2, knowledgeContents: [] };
    const spy = vi.spyOn(apiRequest, "request").mockResolvedValueOnce({ draft: fakeDraft, authoredContent });
    await updatePrivateTutorAuthoredContent("kmd_xyz789", { knowledgeContents: [] });
    expect(spy).toHaveBeenCalledWith("PUT", "/api/private-tutor/knowledge-map-drafts/kmd_xyz789/authored-content", { knowledgeContents: [] });
  });

  it("confirmPrivateTutorAuthoredContent binds review to the current content revision", async () => {
    const authoredContent = { id: "kmd_xyz789_content_v1", version: 1, revision: 2 };
    const spy = vi.spyOn(apiRequest, "request").mockResolvedValueOnce({ draft: fakeDraft, authoredContent });
    await confirmPrivateTutorAuthoredContent("kmd_xyz789", { expectedRevision: 2, acknowledgeContentReview: true });
    expect(spy).toHaveBeenCalledWith("POST", "/api/private-tutor/knowledge-map-drafts/kmd_xyz789/authored-content/confirm", {
      expectedRevision: 2,
      acknowledgeContentReview: true,
    });
  });

  it("publishPrivateTutorKnowledgeMapDraft calls publish endpoint", async () => {
    const spy = vi.spyOn(apiRequest, "request").mockResolvedValueOnce({ success: true, packageId: "pkg-user-deadbeef" });
    const res = await publishPrivateTutorKnowledgeMapDraft("kmd_xyz789");
    expect(res).toEqual({ success: true, packageId: "pkg-user-deadbeef" });
    expect(spy).toHaveBeenCalledWith("POST", "/api/private-tutor/knowledge-map-drafts/kmd_xyz789/publish");
  });

  it("activatePrivateTutorContentPackage preserves the selected chapter entry", async () => {
    const activation = { id: "ptact_1", entryMode: "chapter", startModuleId: "mod_1" };
    const spy = vi.spyOn(apiRequest, "request").mockResolvedValueOnce({ activation });
    const result = await activatePrivateTutorContentPackage({
      packageId: "pkg-user-deadbeef",
      entryMode: "chapter",
      startModuleId: "mod_1",
    });
    expect(result).toEqual({ activation });
    expect(spy).toHaveBeenCalledWith("POST", "/api/private-tutor/profile/content-package/activate", {
      packageId: "pkg-user-deadbeef",
      entryMode: "chapter",
      startModuleId: "mod_1",
    });
  });

  it("getPrivateTutorLearningHistory reads the account-scoped quality projection", async () => {
    const history = { schemaVersion: 1, learnerId: "learner_xyz", packages: [] };
    const spy = vi.spyOn(apiRequest, "request").mockResolvedValueOnce({ history });
    const result = await getPrivateTutorLearningHistory();
    expect(result).toEqual(history);
    expect(spy).toHaveBeenCalledWith("GET", "/api/private-tutor/profile/learning-history");
  });

  it("uses the profile-scoped fourteen-day learning trial contract", async () => {
    const trial = { id: "ptlt_1", durationDays: 14 };
    const spy = vi.spyOn(apiRequest, "request")
      .mockResolvedValueOnce({ trial: null })
      .mockResolvedValueOnce({ trial })
      .mockResolvedValueOnce({ trial: { ...trial, status: "stopped" } });
    expect(await getPrivateTutorLearningTrial()).toBeNull();
    expect(await startPrivateTutorLearningTrial("验证真实课程")).toEqual(trial);
    expect(await stopPrivateTutorLearningTrial()).toEqual({ ...trial, status: "stopped" });
    expect(spy.mock.calls).toEqual([
      ["GET", "/api/private-tutor/profile/learning-trial"],
      ["POST", "/api/private-tutor/profile/learning-trial/start", { goal: "验证真实课程" }],
      ["POST", "/api/private-tutor/profile/learning-trial/stop", {}],
    ]);
  });
});
