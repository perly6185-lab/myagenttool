import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrivateTutorContentMigration } from "@/features/private-tutor/components/private-tutor-content-migration";

const api = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), update: vi.fn(), confirm: vi.fn(), apply: vi.fn(), rollback: vi.fn() }));
vi.mock("@/features/private-tutor/private-tutor-api", () => ({
  listPrivateTutorContentMigrationCandidates: api.list,
  createPrivateTutorContentMigrationPreview: api.create,
  updatePrivateTutorContentMigrationMapping: api.update,
  confirmPrivateTutorContentMigration: api.confirm,
  applyPrivateTutorContentMigration: api.apply,
  rollbackPrivateTutorContentMigration: api.rollback,
}));

const draft = {
  id: "preview_1", revision: 1, status: "draft", previewFingerprint: "fingerprint_1", applicationId: null,
  source: { packageId: "book", packageVersion: "1.0.0", packageName: "教材", contentChecksum: "one" },
  target: { packageId: "book-next", packageVersion: "2.0.0", packageName: "新版教材", contentChecksum: "two" },
  mappings: [{ sourceKnowledgeId: "kc_1", sourceName: "核心概念", targetKnowledgeIds: ["kc_1"], targetNames: ["核心概念"], sourceEvidenceCount: 3, relation: "unchanged", compatibility: "safe", decision: "transfer", changes: [] }],
  targetAdditions: [],
  impact: { transferableKnowledgeCount: 1, provisionalKnowledgeCount: 0, archivedKnowledgeCount: 0, addedKnowledgeCount: 0, transferableEvidenceCount: 3, provisionalEvidenceCount: 0, archivedEvidenceCount: 0, affectedActivePlanCount: 1, affectedOpenSessionCount: 0, activeRuntimeWillChange: false, targetActivationRequired: true, targetStateExists: false, requiresExplicitConfirmation: false },
};

describe("PrivateTutorContentMigration", () => {
  beforeEach(() => {
    api.list.mockResolvedValue([
      { packageId: "book", packageVersion: "1.0.0", packageName: "教材", sourceType: "user_material", status: "published", contentChecksum: "one", knowledgeCount: 1, hasLearningState: true, evidenceCount: 3 },
      { packageId: "book-next", packageVersion: "2.0.0", packageName: "新版教材", sourceType: "user_material", status: "published", contentChecksum: "two", knowledgeCount: 1, hasLearningState: false, evidenceCount: 0 },
    ]);
    api.create.mockResolvedValue(draft);
    api.update.mockResolvedValue({ ...draft, revision: 2, previewFingerprint: "fingerprint_2" });
    api.confirm.mockImplementation(async () => ({ ...draft, status: "confirmed" }));
    api.apply.mockResolvedValue({ id: "application_1", previewId: "preview_1", previewFingerprint: "fingerprint_1", status: "applied", source: draft.source, target: draft.target, transferredKnowledgeCount: 1, provisionalKnowledgeCount: 0, archivedKnowledgeCount: 0, appliedAt: "2026-08-26T00:00:00.000Z", rolledBackAt: null, rollbackReceipt: { sourceFactCountBefore: 3, sourceFactCountAfter: 3, sourceFactsRewritten: 0, targetStateFingerprint: "target", targetPackageWasActivated: false }, rollbackVerification: null });
    api.rollback.mockImplementation(async () => ({ ...(await api.apply.mock.results[0]?.value), status: "rolled_back", rolledBackAt: "2026-08-26T00:01:00.000Z" }));
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("runs preview, explicit confirmation, non-activating apply, and rollback", async () => {
    render(<PrivateTutorContentMigration />);
    await waitFor(() => expect((screen.getByLabelText("迁移来源版本") as HTMLSelectElement).value).toBe("book@1.0.0"));
    fireEvent.click(screen.getByRole("button", { name: "生成迁移预览" }));
    expect(await screen.findByText("安全继承")).toBeTruthy();
    expect(screen.getByText(/它们会留在原版本/)).toBeTruthy();

    fireEvent.click(screen.getByText("我理解原版本作答、评分和学习记录会完整保留。"));
    fireEvent.click(screen.getByRole("button", { name: "确认这份预览" }));
    await waitFor(() => expect(api.confirm).toHaveBeenCalledWith("preview_1", expect.objectContaining({ acknowledgeHistoricalPreservation: true })));
    fireEvent.click(await screen.findByRole("button", { name: "应用迁移（不切换版本）" }));
    expect(await screen.findByText("迁移已应用，目标版本等待你手动启用")).toBeTruthy();
    expect(screen.getByText(/历史改写：0 条/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "应用迁移（不切换版本）" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "回滚这次迁移" }));
    expect(await screen.findByText("迁移已回滚")).toBeTruthy();
  });

  it("keeps target options available and blocks confirmation until mapping edits are saved", async () => {
    render(<PrivateTutorContentMigration />);
    await waitFor(() => expect((screen.getByLabelText("迁移来源版本") as HTMLSelectElement).value).toBe("book@1.0.0"));
    fireEvent.click(screen.getByRole("button", { name: "生成迁移预览" }));
    const mapping = await screen.findByLabelText("核心概念的目标知识点") as HTMLSelectElement;
    mapping.options[0].selected = false;
    fireEvent.change(mapping);

    expect([...mapping.options].some((option) => option.value === "kc_1")).toBe(true);
    expect(screen.getByText("映射有未保存修改，请先保存并重新计算影响。")).toBeTruthy();
    expect((screen.getByRole("button", { name: "确认这份预览" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "保存映射并重新计算" }));
    await waitFor(() => expect(api.update).toHaveBeenCalled());
    expect(screen.queryByText("映射有未保存修改，请先保存并重新计算影响。")).toBeNull();
  });
});
