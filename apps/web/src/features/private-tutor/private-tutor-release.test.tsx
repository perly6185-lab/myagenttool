import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfessionalTutorEntry } from "@/features/private-tutor/private-tutor-professional-entry";

const apiMocks = vi.hoisted(() => ({ evaluate: vi.fn(), createPilot: vi.fn(), getPilot: vi.fn(), getOperations: vi.fn(), pausePilot: vi.fn(), resumePilot: vi.fn(), updateIncident: vi.fn(), listContent: vi.fn(), createRevision: vi.fn() }));

vi.mock("@/hooks/use-session-user", () => ({
  useSessionUser: () => ({ id: "usr_owner", role: "owner", privateTutorChildMode: null }),
}));

const blocked = {
  status: "blocked", ready: false, rule: "所有门禁均通过后，才允许创建 30–100 名学生、7 天的受控试点。",
  buildId: "source:test-build", scopeChecksum: "a".repeat(64), evaluatedAt: "2026-08-21T00:00:00.000Z", evidenceContractVersion: 2,
  gates: [
    releaseGate("math_content", "数学内容双人审核", true, "not_evaluated", 0, "content-review", "正式题目与答案审查", "manual_review"),
    releaseGate("child_safety", "儿童安全评审", false, "passed", 1, "safety-review", "儿童安全人工评审", "manual_review", "安全评审已完成"),
  ],
} as const;
const ready = {
  ...blocked,
  status: "ready_for_controlled_pilot",
  ready: true,
  gates: blocked.gates.map((gate) => ({ ...gate, status: "passed" as const, completedTargets: 1, missingTargetIds: [], passedReviewers: gate.doubleReview ? 2 : 1, latestEvidence: "双人复核已完成", targets: gate.targets.map((target) => ({ ...target, status: "passed" as const, passedReviewers: gate.doubleReview ? 2 : 1 })) })),
} as const;
const cohort = { id: "ptpc_1", status: "active", participantTarget: 50, durationDays: 7, responseOwner: "安全值班负责人", consentDocumentId: "pt-consent-v1", consentDocumentVersion: "2026-08-21.v1", consentDocumentChecksum: "checksum", exitPolicy: "guardian_can_withdraw_and_request_deletion", createdBy: "usr_owner", startedAt: "2026-08-20T00:00:00.000Z", endsAt: "2026-08-27T00:00:00.000Z", pausedAt: null, pausedBy: null, pauseReason: null } as const;
const metrics = { cohortId: "ptpc_1", status: "active", participantTarget: 50, enrollment: { consented: 12, active: 10, withdrawn: 2, capacityRemaining: 38 }, engagement: { learnersWithCompletedSessions: 8, returningLearners: 5, completedSessions: 14, learningMinutes: 280, evidenceCount: 60, independentCorrectRate: 0.7, hintDependenceRate: 0.2 }, experience: { checkInCount: 9, guardianPressure: { low: 3, manageable: 5, high: 1 }, childWillingToReturn: { yes: 7, unsure: 1, no: 1 } }, safety: { total: 1, open: 1, escalated: 1, critical: 0 }, privacy: { learnerIdsExposed: false, rawAnswersExposed: false, incidentFreeTextExposed: false }, generatedAt: "2026-08-21T00:00:00.000Z" } as const;
const incident = { id: "ptin_1", cohortId: "ptpc_1", learnerId: "lrn_1", category: "content_error", severity: "high", summary: "题目展示存在歧义，需要教研复核。", status: "escalated", createdAt: "2026-08-21T00:00:00.000Z", resolution: null } as const;
const draftRevision = { id: "ptqr_2", questionId: "demo-balance-001", version: 2, context: "practice", knowledgeId: "balance", difficulty: 2, kind: "numeric", prompt: "x + 6 = 14，x 是多少？", options: null, expectedChoice: null, expectedAnswer: "8", allowVariableAssignment: true, contentChecksum: "abcdef1234567890", createdBy: "usr_owner", createdAt: "2026-08-20T00:00:00.000Z", status: "draft", active: false, approvals: 0, requiredApprovals: 2, reviews: [] } as const;

vi.mock("@/features/private-tutor/private-tutor-api", () => ({
  listPrivateTutorLearners: () => Promise.resolve([]),
  listPrivateTutorDeletionJobs: () => Promise.resolve([]),
  getPrivateTutorReleaseReadiness: () => Promise.resolve(blocked),
  getPrivateTutorPilot: apiMocks.getPilot,
  getPrivateTutorPilotOperations: apiMocks.getOperations,
  evaluatePrivateTutorReleaseGate: apiMocks.evaluate,
  createPrivateTutorPilot: apiMocks.createPilot,
  pausePrivateTutorPilot: apiMocks.pausePilot,
  resumePrivateTutorPilot: apiMocks.resumePilot,
  updatePrivateTutorPilotIncident: apiMocks.updateIncident,
  listPrivateTutorQuestionRevisions: apiMocks.listContent,
  createPrivateTutorQuestionRevision: apiMocks.createRevision,
  submitPrivateTutorQuestionRevision: vi.fn(),
  reviewPrivateTutorQuestionRevision: vi.fn(),
  publishPrivateTutorQuestionRevision: vi.fn(),
  disablePrivateTutorQuestionRevision: vi.fn(),
  rollbackPrivateTutorQuestion: vi.fn(),
  createPrivateTutorLearner: () => Promise.reject(new Error("not used")),
  startPrivateTutorChildMode: () => Promise.reject(new Error("not used")),
  exitPrivateTutorChildMode: () => Promise.reject(new Error("not used")),
}));

describe("My private tutor controlled release", () => {
  beforeEach(() => {
    apiMocks.evaluate.mockResolvedValue({ evaluation: { id: "ptge_1" }, readiness: ready });
    apiMocks.createPilot.mockResolvedValue(cohort);
    apiMocks.getPilot.mockResolvedValue({ cohorts: [], readiness: blocked });
    apiMocks.getOperations.mockResolvedValue({ cohorts: [], incidents: [], metrics: [], consentDocument: {} });
    apiMocks.pausePilot.mockResolvedValue({ ...cohort, status: "paused", pausedAt: "2026-08-21T01:00:00.000Z", pausedBy: "usr_owner", pauseReason: "儿童安全复核" });
    apiMocks.listContent.mockResolvedValue([]);
    apiMocks.createRevision.mockResolvedValue(draftRevision);
  });

  it("shows aggregate-only pilot metrics and lets the response owner pause new learning writes", async () => {
    apiMocks.getPilot.mockResolvedValue({ cohorts: [cohort], readiness: ready });
    apiMocks.getOperations.mockResolvedValue({ cohorts: [cohort], incidents: [incident], metrics: [metrics], consentDocument: {} });
    render(<ProfessionalTutorEntry />);

    expect(await screen.findByText("已同意")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("题目展示存在歧义，需要教研复核。")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("试点操作原因"), { target: { value: "儿童安全复核" } });
    fireEvent.click(screen.getByRole("button", { name: "暂停试点" }));
    await waitFor(() => expect(apiMocks.pausePilot).toHaveBeenCalledWith("ptpc_1", "儿童安全复核"));
    expect(await screen.findByText(/试点已暂停，已入组孩子的新学习写入已锁定/)).toBeTruthy();
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("requires evidence for a gate before enabling a bounded pilot", async () => {
    render(<ProfessionalTutorEntry />);
    expect(await screen.findByText("受控上线门禁")).toBeTruthy();
    expect(screen.getByText("版本化题目后台")).toBeTruthy();
    expect(screen.getByText("质量与安全空间")).toBeTruthy();
    expect(screen.queryByText("添加孩子")).toBeNull();
    expect(screen.queryByText("家长准备好，再交给孩子")).toBeNull();
    expect(screen.getByText(/覆盖目标 0\/1 · 双人复核 0\/2/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "创建受控试点" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("当前门禁的审计证据"), { target: { value: "第二位教研已复核题目与答案" } });
    fireEvent.change(screen.getByLabelText("证据附件名称"), { target: { value: "math-review.json" } });
    fireEvent.change(screen.getByLabelText("证据附件 SHA-256"), { target: { value: "c".repeat(64) } });
    fireEvent.click(screen.getByRole("button", { name: "记录通过" }));
    await waitFor(() => expect(apiMocks.evaluate).toHaveBeenCalledWith(expect.objectContaining({
      gateId: "math_content", targetId: "content-review", status: "passed", evidence: "第二位教研已复核题目与答案",
      evidenceType: "manual_review", artifactName: "math-review.json", artifactChecksumSha256: "c".repeat(64),
      environment: { deviceClass: "not_applicable", operatingSystem: "not_applicable", browserEngine: "not_applicable", networkProfile: "not_applicable" },
      executedAt: expect.any(String),
    })));

    expect((screen.getByRole("button", { name: "创建受控试点" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("异常响应负责人"), { target: { value: "安全值班负责人" } });
    fireEvent.click(screen.getByRole("button", { name: "创建受控试点" }));
    await waitFor(() => expect(apiMocks.createPilot).toHaveBeenCalledWith({ participantTarget: 50, responseOwner: "安全值班负责人" }));
    expect(await screen.findByText(/试点进行中：目标 50 人/)).toBeTruthy();
  });

  it("creates a locked question draft before review or publication", async () => {
    render(<ProfessionalTutorEntry />);
    await screen.findByText("版本化题目后台");
    fireEvent.change(screen.getByLabelText("题干"), { target: { value: "x + 6 = 14，x 是多少？" } });
    fireEvent.change(screen.getByLabelText("标准答案"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "创建不可变草稿" }));
    await waitFor(() => expect(apiMocks.createRevision).toHaveBeenCalledWith(expect.objectContaining({
      questionId: "demo-balance-001", context: "practice", knowledgeId: "balance", kind: "numeric", expectedAnswer: "8",
    })));
    expect(await screen.findByText(/已创建 demo-balance-001 v2 草稿/)).toBeTruthy();
  });
});

function releaseGate(id: string, label: string, doubleReview: boolean, status: "passed" | "not_evaluated", passedReviewers: number, targetId: string, targetLabel: string, evidenceType: "manual_review", latestEvidence: string | null = null) {
  const environment = { deviceClass: "not_applicable", operatingSystem: "not_applicable", browserEngine: "not_applicable", networkProfile: "not_applicable" } as const;
  return {
    id, label, required: true as const, doubleReview, evidenceValidityDays: 90, status,
    completedTargets: status === "passed" ? 1 : 0, missingTargetIds: status === "passed" ? [] : [targetId], expiredEvidenceCount: 0,
    passedReviewers, latestEvidence, evaluatedAt: latestEvidence ? "2026-08-20T00:00:00.000Z" : null,
    targets: [{ id: targetId, label: targetLabel, evidenceType, environment, status, requiredReviewers: doubleReview ? 2 : 1, passedReviewers, expiredEvidenceCount: 0, latestEvidence, latestArtifact: null, executedAt: null, expiresAt: null, evaluatedAt: null }],
  };
}
