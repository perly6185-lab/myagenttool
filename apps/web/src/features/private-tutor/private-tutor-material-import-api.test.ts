import { describe, expect, it, vi } from "vitest";
import {
  listPrivateTutorMaterials,
  uploadPrivateTutorMaterial,
  getPrivateTutorMaterial,
  deletePrivateTutorMaterial,
  generatePrivateTutorKnowledgeMapDraft,
  getPrivateTutorKnowledgeMapDraft,
  updatePrivateTutorKnowledgeMapDraft,
  confirmPrivateTutorKnowledgeMapDraft,
  publishPrivateTutorKnowledgeMapDraft,
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

  it("publishPrivateTutorKnowledgeMapDraft calls publish endpoint", async () => {
    const spy = vi.spyOn(apiRequest, "request").mockResolvedValueOnce({ success: true, packageId: "pkg-user-deadbeef" });
    const res = await publishPrivateTutorKnowledgeMapDraft("kmd_xyz789");
    expect(res).toEqual({ success: true, packageId: "pkg-user-deadbeef" });
    expect(spy).toHaveBeenCalledWith("POST", "/api/private-tutor/knowledge-map-drafts/kmd_xyz789/publish");
  });
});
