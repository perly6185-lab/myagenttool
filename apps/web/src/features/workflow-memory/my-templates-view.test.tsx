import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MyTemplatesView } from "@/features/workflow-memory/my-templates-view";

const mocks = vi.hoisted(() => ({
  listSources: vi.fn(),
  listDefinitions: vi.fn(),
  createSource: vi.fn(),
  scanSource: vi.fn(),
  createTemplateLearningTask: vi.fn(),
  uploadTemplateLearningFile: vi.fn(),
  startTemplateLearningTask: vi.fn(),
  listTemplateLearningTasks: vi.fn(),
  getWorkflowOcrReadiness: vi.fn(),
  listChannelObjects: vi.fn(),
  upsertChannelObject: vi.fn(),
  setChannelObjectStatus: vi.fn(),
  previewChannelObjectImport: vi.fn(),
  confirmChannelObjectImport: vi.fn(),
  listChannelObjectConnectors: vi.fn(),
  listChannelObjectConnectorConfigs: vi.fn(),
  listChannelObjectFileSources: vi.fn(),
  upsertChannelObjectConnectorConfig: vi.fn(),
  previewChannelObjectConnectorSync: vi.fn(),
  confirmChannelObjectConnectorSync: vi.fn(),
  testChannelObjectConnectorConfig: vi.fn(),
  syncChannelObjectConnector: vi.fn(),
  bindProject: vi.fn(),
  listLearning: vi.fn(),
  removeLearning: vi.fn(),
  listOutcomes: vi.fn(),
  recordOutcome: vi.fn(),
  resumeGovernance: vi.fn(),
  listTaskDrafts: vi.fn(),
  listSimilarTasks: vi.fn(),
  addLearningCase: vi.fn(),
  activateTaskTemplate: vi.fn(),
}));

vi.mock("@/data/use-console-actions", () => ({ api: {
  bindProject: mocks.bindProject,
  listMyTemplateLearning: mocks.listLearning,
  removeMyTemplateLearning: mocks.removeLearning,
  listMyTemplateOutcomes: mocks.listOutcomes,
  recordMyTemplateOutcomeFeedback: mocks.recordOutcome,
  resumeMyTemplateGovernanceObservation: mocks.resumeGovernance,
  listMyTemplateDrafts: mocks.listTaskDrafts,
  listSimilarMyTemplateWorkItems: mocks.listSimilarTasks,
  addMyTemplateLearningCase: mocks.addLearningCase,
  activateMyTemplateDraft: mocks.activateTaskTemplate,
} }));
vi.mock("@/data/use-console-state", () => ({
  useConsoleState: () => ({ data: {
    currentProjectId: "project-1",
    projects: [{ id: "project-1", name: "客户工作", path: "/work/client", status: "active" }],
  } }),
  useRefreshConsoleState: () => vi.fn(),
}));
vi.mock("@/features/workflow-memory/workflow-memory-api", () => ({
  workflowMemoryApi: {
    listWorkflowSources: mocks.listSources,
    listBusinessRoutineDefinitions: mocks.listDefinitions,
    createWorkflowSource: mocks.createSource,
    scanWorkflowSource: mocks.scanSource,
    createTemplateLearningTask: mocks.createTemplateLearningTask,
    uploadTemplateLearningFile: mocks.uploadTemplateLearningFile,
    startTemplateLearningTask: mocks.startTemplateLearningTask,
    listTemplateLearningTasks: mocks.listTemplateLearningTasks,
    getWorkflowOcrReadiness: mocks.getWorkflowOcrReadiness,
    listChannelObjects: mocks.listChannelObjects,
    upsertChannelObject: mocks.upsertChannelObject,
    setChannelObjectStatus: mocks.setChannelObjectStatus,
    previewChannelObjectImport: mocks.previewChannelObjectImport,
    confirmChannelObjectImport: mocks.confirmChannelObjectImport,
    listChannelObjectConnectors: mocks.listChannelObjectConnectors,
    listChannelObjectConnectorConfigs: mocks.listChannelObjectConnectorConfigs,
    listChannelObjectFileSources: mocks.listChannelObjectFileSources,
    upsertChannelObjectConnectorConfig: mocks.upsertChannelObjectConnectorConfig,
    previewChannelObjectConnectorSync: mocks.previewChannelObjectConnectorSync,
    confirmChannelObjectConnectorSync: mocks.confirmChannelObjectConnectorSync,
    testChannelObjectConnectorConfig: mocks.testChannelObjectConnectorConfig,
    syncChannelObjectConnector: mocks.syncChannelObjectConnector,
  },
}));
vi.mock("@/features/workflow-memory/workflow-memory-view", () => ({
  WorkflowMemoryView: ({ backLabel }: { backLabel?: string }) => <div>{backLabel} · 学习编辑器</div>,
}));
vi.mock("@/features/workflow-memory/my-template-setup-wizard", () => ({
  MyTemplateSetupWizard: ({ onOpenAdvanced }: { onOpenAdvanced: () => void }) => (
    <div>普通三步向导<button onClick={onOpenAdvanced}>高级调整</button></div>
  ),
}));

const source = {
  id: "source-1", projectId: "project-1", name: "客户询价历史", relativePath: "history",
  readMode: "supported_text", state: "active", scanState: "ready", scanRevision: 1, revision: 1,
  fileCount: 12, skippedCount: 0, truncated: false, lastScanAt: null, lastError: null,
};
const definition = {
  id: "definition-1", familyId: "family-1", projectId: "project-1", sourceId: source.id,
  name: "客户询价报价", description: "收到询价后生成报价单", version: 2, state: "published",
  discoveryCandidateId: "candidate-1", historicalCaseIds: ["case-1", "case-2", "case-3"],
  triggerDocumentTypes: ["inquiry"],
  steps: [{ key: "output", kind: "generate", label: "生成报价单", required: true, dependsOn: [],
    evidenceRefs: [], configuration: { output: "报价单 Excel" } }],
  confidence: 0.9, supersedesId: null, supersededById: null,
  templateScope: "team",
  evidenceHealth: { state: "valid", issues: [], recovery: null }, revision: 1,
  createdAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:00:00.000Z",
};

function renderView() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MyTemplatesView />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.history.replaceState({}, "", window.location.pathname);
  window.myagenttoolDesktop = undefined;
  mocks.listSources.mockResolvedValue({ sources: [source] });
  mocks.listDefinitions.mockResolvedValue({ routineDefinitions: [definition], count: 1 });
  mocks.listChannelObjects.mockResolvedValue({ objects: [], count: 0 });
  mocks.listChannelObjectConnectors.mockResolvedValue({ connectors: [] });
  mocks.listChannelObjectConnectorConfigs.mockResolvedValue({ configs: [], count: 0 });
  mocks.listChannelObjectFileSources.mockResolvedValue({ sources: [], count: 0 });
  mocks.listLearning.mockResolvedValue({ feedback: [], count: 0 });
  mocks.removeLearning.mockResolvedValue({ removed: { id: "feedback-1" }, affectsFutureMatchesOnly: true });
  mocks.listOutcomes.mockResolvedValue({ feedback: [], summaries: [], count: 0 });
  mocks.recordOutcome.mockResolvedValue({ feedback: {}, workItem: {} });
  mocks.resumeGovernance.mockResolvedValue({ governance: { state: "watch", manualObservation: true } });
  mocks.listTaskDrafts.mockResolvedValue({ drafts: [], count: 0 });
  mocks.listSimilarTasks.mockResolvedValue({ draft: null, cases: [], suggestions: [], count: 0 });
  mocks.addLearningCase.mockResolvedValue({ draft: {}, readyForReview: false });
  mocks.activateTaskTemplate.mockResolvedValue({ draft: {}, definition: {}, replayed: false });
  mocks.createTemplateLearningTask.mockResolvedValue({
    task: { id: "learning-1" },
    source: { ...source, id: "source-2", purpose: "template_learning" },
    workItem: { id: "work-learning-1", localRef: "LOCAL-20", title: "创建模板：合同登记" },
  });
  mocks.uploadTemplateLearningFile.mockResolvedValue({ task: { id: "learning-1" } });
  mocks.startTemplateLearningTask.mockResolvedValue({ task: { id: "learning-1", stage: "needs_case_review" } });
  mocks.listTemplateLearningTasks.mockResolvedValue({ tasks: [] });
  mocks.getWorkflowOcrReadiness.mockResolvedValue({ state: "ready", providerId: "test-ocr", reason: null, localOnly: true, supportedExtensions: [".pdf", ".png", ".jpg", ".jpeg", ".webp"] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MyTemplatesView", () => {
  it("shows ordinary users what each learned template receives and produces", async () => {
    renderView();
    expect(await screen.findByRole("heading", { name: "我的模板" })).toBeTruthy();
    expect(await screen.findByText("客户询价报价")).toBeTruthy();
    expect(screen.getByText("客户询价单")).toBeTruthy();
    expect(screen.getByText("报价单 Excel")).toBeTruthy();
    expect(screen.getByText(/3 组历史案例/)).toBeTruthy();
  });

  it("shows one task-seeded case as ready for review but excluded from matching until confirmation", async () => {
    mocks.listTaskDrafts.mockResolvedValue({
      drafts: [{
        id: "mtd-1", projectId: "project-1", name: "客户回访汇总",
        typicalInput: "客户回访记录", expectedOutput: "客户回访汇总表",
        applicability: "当收到客户回访记录，并希望得到客户回访汇总表时",
        steps: ["读取记录", "生成汇总"], state: "needs_review", caseCount: 1, casesRequired: 1, revision: 1,
        origin: { kind: "work_item", workItemId: "work-1", localRef: "LOCAL-8", title: "整理客户回访" },
        createdAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:00:00.000Z",
      }],
      count: 1,
    });
    renderView();

    expect(await screen.findByRole("heading", { name: "从任务学会的模板" })).toBeTruthy();
    expect(screen.getByText("客户回访汇总")).toBeTruthy();
    expect(screen.getByText("已从 1 个成功案例中学习")).toBeTruthy();
    expect(screen.getByText(/确认前不会参与自动匹配/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "检查并启用" })).toBeTruthy();
    expect(screen.getByText(/LOCAL-8 · 整理客户回访/)).toBeTruthy();
  });

  it("explains similar-task recommendations and adds one only after the user confirms it", async () => {
    const draft = {
      id: "mtd-1", projectId: "project-1", name: "客户回访汇总",
      typicalInput: "客户回访记录", expectedOutput: "客户回访汇总表.xlsx",
      applicability: "当收到客户回访记录，并希望得到客户回访汇总表时",
      steps: ["读取记录", "生成汇总"], state: "needs_review", caseCount: 1, casesRequired: 1, revision: 1,
      origin: { kind: "work_item", workItemId: "work-1", localRef: "LOCAL-8", title: "整理客户回访" },
      createdAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:00:00.000Z",
    };
    const sourceCase = {
      id: "case-1", workItem: { id: "work-1", localRef: "LOCAL-8", title: "整理客户回访", completedAt: "2026-08-10T00:00:00.000Z" },
      typicalInput: "客户回访记录", expectedOutput: "客户回访汇总表.xlsx", similarity: null,
      createdAt: "2026-08-11T00:00:00.000Z",
    };
    const suggestion = {
      workItem: { id: "work-2", localRef: "LOCAL-9", title: "八月客户回访汇总", completedAt: "2026-08-11T00:00:00.000Z", revision: 4 },
      similarity: 0.78, confidence: "high", reasons: ["交付结果相似", "输入材料相似"],
      typicalInput: "客户回访-八月.xlsx", expectedOutput: "客户回访汇总-八月.xlsx",
      evidence: { inputCount: 1, outputCount: 1, passedVerification: true, passedAcceptance: true, hasDeliveryReport: true },
    };
    mocks.listTaskDrafts.mockResolvedValue({ drafts: [draft], count: 1 });
    const review = {
      learnedResult: {
        taskGoal: draft.name, typicalInput: draft.typicalInput,
        useWhen: draft.applicability, expectedOutput: draft.expectedOutput,
        steps: draft.steps, inputExamples: [sourceCase.typicalInput], outputExamples: [sourceCase.expectedOutput],
      },
      readiness: { canEnable: true, confidence: "initial", caseCount: 1, message: "已有一个成功案例，可以启用。" },
      futureBehavior: { participatesInMatching: false, affectsExistingTasks: false, requiresExplicitConfirmation: true },
    };
    mocks.listSimilarTasks
      .mockResolvedValueOnce({ draft, cases: [sourceCase], suggestions: [suggestion], count: 1, review })
      .mockResolvedValueOnce({
        draft: { ...draft, revision: 2, caseCount: 2 },
        cases: [sourceCase, { ...sourceCase, id: "case-2", workItem: suggestion.workItem, similarity: { score: 0.78, confidence: "high", reasons: suggestion.reasons } }],
        suggestions: [], count: 0,
        review: { ...review, readiness: { ...review.readiness, confidence: "medium", caseCount: 2, message: "已用 2 个成功案例交叉验证，可以启用。" } },
      });
    mocks.addLearningCase.mockResolvedValue({ draft: { ...draft, revision: 2, caseCount: 2 }, readyForReview: true });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "检查并启用" }));
    expect(await screen.findByRole("heading", { name: "客户回访汇总 · 检查学习结果" })).toBeTruthy();
    expect(await screen.findByText("LOCAL-9 · 八月客户回访汇总")).toBeTruthy();
    expect(screen.getByText("相似度 78%")).toBeTruthy();
    expect(screen.getByText("交付结果相似 · 输入材料相似")).toBeTruthy();
    expect(mocks.addLearningCase).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "确认加入案例" }));
    await waitFor(() => expect(mocks.addLearningCase).toHaveBeenCalledWith("mtd-1", {
      workItemId: "work-2", expectedDraftRevision: 1, expectedWorkItemRevision: 4, confirm: true,
    }));
    expect(await screen.findByText("案例已加入。当前已可确认启用，也可以继续补充更多案例。")).toBeTruthy();
    expect(await screen.findByText("人工确认加入")).toBeTruthy();
  });

  it("lets an ordinary user review one learned case, correct the result, and explicitly enable matching", async () => {
    const draft = {
      id: "mtd-enable", projectId: "project-1", name: "客户回访汇总",
      typicalInput: "客户回访记录", expectedOutput: "客户回访汇总表",
      applicability: "当收到客户回访记录，并希望得到客户回访汇总表时",
      steps: ["读取回访记录", "整理重点", "生成汇总"], state: "needs_review", caseCount: 1, casesRequired: 1, revision: 1,
      origin: { kind: "work_item", workItemId: "work-enable", localRef: "LOCAL-10", title: "整理客户回访" },
      createdAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:00:00.000Z",
    };
    const learningCase = {
      id: "case-enable",
      workItem: { id: "work-enable", localRef: "LOCAL-10", title: "整理客户回访", completedAt: "2026-08-11T00:00:00.000Z" },
      typicalInput: "客户回访记录", expectedOutput: "客户回访汇总表", similarity: null,
      createdAt: "2026-08-11T00:00:00.000Z",
    };
    const review = {
      learnedResult: {
        taskGoal: draft.name, typicalInput: draft.typicalInput, useWhen: draft.applicability,
        expectedOutput: draft.expectedOutput, steps: draft.steps,
        inputExamples: [draft.typicalInput], outputExamples: [draft.expectedOutput],
      },
      readiness: {
        canEnable: true, confidence: "initial", caseCount: 1,
        message: "已具备一个成功案例，可以启用；系统会继续根据后续任务结果校正匹配。",
      },
      futureBehavior: { participatesInMatching: false, affectsExistingTasks: false, requiresExplicitConfirmation: true },
    };
    const readyDraft = {
      ...draft, state: "ready", revision: 2, expectedOutput: "客户回访分析报告",
      activation: { definitionId: "definition-enable", familyId: "definition-enable", version: 1, confirmedAt: "2026-08-11T01:00:00.000Z", confirmedBy: "user-1" },
    };
    mocks.listTaskDrafts.mockResolvedValue({ drafts: [draft], count: 1 });
    mocks.listSimilarTasks
      .mockResolvedValueOnce({ draft, cases: [learningCase], suggestions: [], count: 0, review })
      .mockResolvedValueOnce({
        draft: readyDraft, cases: [learningCase], suggestions: [], count: 0,
        review: {
          ...review,
          learnedResult: { ...review.learnedResult, expectedOutput: "客户回访分析报告" },
          readiness: { ...review.readiness, canEnable: false },
          futureBehavior: { participatesInMatching: true, affectsExistingTasks: false, requiresExplicitConfirmation: false },
        },
      });
    mocks.activateTaskTemplate.mockResolvedValue({ draft: readyDraft, definition: { id: "definition-enable", state: "published" }, replayed: false });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "检查并启用" }));
    expect(await screen.findByRole("heading", { name: "系统学到了什么" })).toBeTruthy();
    expect(screen.getByText(/目前依据 1 个成功案例/)).toBeTruthy();
    const enableButton = screen.getByRole("button", { name: "确认并启用自动匹配" }) as HTMLButtonElement;
    expect(enableButton.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("最后应该得到什么"), { target: { value: "客户回访分析报告" } });
    expect(mocks.activateTaskTemplate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText(/我确认以上输入和产出描述正确/));
    expect(enableButton.disabled).toBe(false);
    fireEvent.click(enableButton);

    await waitFor(() => expect(mocks.activateTaskTemplate).toHaveBeenCalledWith("mtd-enable", {
      expectedDraftRevision: 1,
      confirm: true,
      name: "客户回访汇总",
      typicalInput: "客户回访记录",
      expectedOutput: "客户回访分析报告",
    }));
    expect(await screen.findByText(/已启用。以后创建相似任务时/)).toBeTruthy();
    expect(await screen.findByText("正在用于未来任务")).toBeTruthy();
  });

  it("summarizes feedback from completed real tasks without calling quality issues a wrong match", async () => {
    mocks.listOutcomes.mockResolvedValue({
      feedback: [],
      summaries: [{
        familyId: "family-1", total: 4, metExpectations: 1, wrongResult: 2,
        needsQualityAdjustment: 1, state: "needs_attention",
        governance: {
          state: "watch", matchingFeedbackCount: 3, wrongResultRate: 0.6667,
          autoMatchAllowed: true, requiresConfirmation: true, reason: "elevated_wrong_result_feedback",
          manualObservation: false, historicalFeedbackCount: 0, latestIntervention: null,
        },
      }],
      count: 4,
    });
    renderView();

    expect(await screen.findByText("实际任务反馈")).toBeTruthy();
    expect(screen.getByText("使用前确认")).toBeTruthy();
    expect(screen.getByText(/4 次反馈 · 1 次符合预期 · 2 次结果类型不对 · 1 次内容需调整/)).toBeTruthy();
    expect(screen.getByText(/近期有较多“结果类型不对”的反馈.*使用前会先请你确认/)).toBeTruthy();
  });

  it("shows when repeated wrong result types pause automatic matching and explains recovery", async () => {
    mocks.listOutcomes.mockResolvedValue({
      feedback: [],
      summaries: [{
        familyId: "family-1", total: 5, metExpectations: 2, wrongResult: 3,
        needsQualityAdjustment: 0, state: "needs_attention",
        governance: {
          state: "paused", matchingFeedbackCount: 5, wrongResultRate: 0.6,
          autoMatchAllowed: false, requiresConfirmation: true, reason: "repeated_wrong_result_feedback",
          manualObservation: false, historicalFeedbackCount: 0, latestIntervention: null,
        },
      }],
      count: 5,
    });
    renderView();

    expect(await screen.findByText("已暂停")).toBeTruthy();
    expect(screen.getByText(/系统已暂停使用.*手动恢复/)).toBeTruthy();
  });

  it("shows which tasks affected governance and lets the user correct a mislabeled result", async () => {
    mocks.listOutcomes.mockResolvedValue({
      feedback: [{
        id: "outcome-1", projectId: "project-1", workItemId: "work-1", familyId: "family-1", version: 2,
        outcome: "wrong_result", note: "最初点错了", governanceImpact: "negative",
        workItem: { id: "work-1", localRef: "LOC-18", title: "生成客户报价", status: "done" },
        createdAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:00:00.000Z",
      }],
      summaries: [{
        familyId: "family-1", total: 5, metExpectations: 2, wrongResult: 3,
        needsQualityAdjustment: 0, state: "needs_attention",
        governance: {
          state: "paused", matchingFeedbackCount: 5, wrongResultRate: 0.6,
          autoMatchAllowed: false, requiresConfirmation: true, reason: "repeated_wrong_result_feedback",
          manualObservation: false, historicalFeedbackCount: 0, latestIntervention: null,
        },
      }], count: 5,
    });
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "查看使用情况" }));

    expect(screen.getByRole("heading", { name: /客户询价报价 · 使用情况/ })).toBeTruthy();
    expect(screen.getByText(/LOC-18 生成客户报价/)).toBeTruthy();
    expect(screen.getByText("降低匹配可信度")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "修正反馈" }));
    fireEvent.change(screen.getByLabelText("这次实际情况"), { target: { value: "met_expectations" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修正" }));

    await waitFor(() => expect(mocks.recordOutcome).toHaveBeenCalledWith("work-1", {
      outcome: "met_expectations", note: "最初点错了",
    }));
  });

  it("requires confirmation before manually returning a paused template to observation", async () => {
    mocks.listOutcomes.mockResolvedValue({
      feedback: [], summaries: [{
        familyId: "family-1", total: 5, metExpectations: 2, wrongResult: 3,
        needsQualityAdjustment: 0, state: "needs_attention",
        governance: {
          state: "paused", matchingFeedbackCount: 5, wrongResultRate: 0.6,
          autoMatchAllowed: false, requiresConfirmation: true, reason: "repeated_wrong_result_feedback",
          manualObservation: false, historicalFeedbackCount: 0, latestIntervention: null,
        },
      }], count: 5,
    });
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "恢复使用" }));
    expect(screen.getByRole("heading", { name: "恢复使用这个模板？" })).toBeTruthy();
    expect(screen.getByText(/必要时再次暂停/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认恢复" }));

    await waitFor(() => expect(mocks.resumeGovernance).toHaveBeenCalledWith("family-1", {
      projectId: "project-1", confirm: true,
    }));
  });

  it("keeps a manually resumed template in confirmation-only observation until new successes arrive", async () => {
    mocks.listOutcomes.mockResolvedValue({
      feedback: [], summaries: [{
        familyId: "family-1", total: 5, metExpectations: 2, wrongResult: 3,
        needsQualityAdjustment: 0, state: "needs_attention",
        governance: {
          state: "watch", matchingFeedbackCount: 0, wrongResultRate: 0,
          autoMatchAllowed: true, requiresConfirmation: true, reason: "manual_resume_observation",
          manualObservation: true, historicalFeedbackCount: 5,
          latestIntervention: {
            id: "mtgi-1", action: "resume_observation", reason: "user_reviewed_governance_details",
            createdAt: "2026-08-11T02:00:00.000Z", createdBy: "usr-a",
          },
        },
      }], count: 5,
    });
    renderView();

    expect(await screen.findByText("使用前确认")).toBeTruthy();
    expect(screen.getByText(/每次使用前都会请你确认.*新的成功结果后.*恢复自动使用/)).toBeTruthy();
  });

  it("opens the simple three-step wizard and keeps the existing editor behind Advanced", async () => {
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: /查看和管理/ }));
    expect(await screen.findByText("普通三步向导")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "高级调整" }));
    expect(await screen.findByText(/返回简易向导 · 学习编辑器/)).toBeTruthy();
  });

  it("shows what matching learned from a correction and lets the user forget it", async () => {
    mocks.listLearning
      .mockResolvedValueOnce({
        feedback: [{
          id: "feedback-1", projectId: "project-1", workItemId: "wi-1",
          workItem: { id: "wi-1", localRef: "LOC-12", title: "处理客户询价" },
          intentTerms: ["询价"], rejectedOutput: "报价单 Excel", selectedOutput: "询价汇总表",
          reason: "你确认这次需要询价汇总表", createdAt: "2026-08-11T00:00:00.000Z",
          state: "conflict", conflictingOutputs: ["报价单 Excel", "询价汇总表"],
        }],
        count: 1,
      })
      .mockResolvedValueOnce({ feedback: [], count: 0 });
    renderView();

    expect(await screen.findByText(/任务提到“询价”时/)).toBeTruthy();
    expect(screen.getByText(/优先得到“询价汇总表”，而不是“报价单 Excel”/)).toBeTruthy();
    expect(screen.getByText("存在冲突")).toBeTruthy();
    expect(screen.getByText(/创建任务时系统会先请你确认/)).toBeTruthy();
    expect(screen.getByText(/来自 LOC-12 处理客户询价/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "忘记这条" }));
    expect(screen.getByRole("heading", { name: "让系统忘记这条选择？" })).toBeTruthy();
    expect(screen.getByText(/已经创建或执行的任务不会改变/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认忘记" }));

    await waitFor(() => expect(mocks.removeLearning).toHaveBeenCalledWith("feedback-1"));
    expect(await screen.findByText(/还没有记住任何纠正/)).toBeTruthy();
  });

  it("creates a tracked template-learning task from explicit input and output files", async () => {
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: /创建我的模板/ }));
    expect(screen.getByText(/格式：PDF、Word（\.docx）、Excel（\.xlsx）/)).toBeTruthy();
    expect(screen.getByLabelText("案例 1 的历史输入").getAttribute("accept")).not.toContain(".xls,");
    const input = new File(["input"], "客户合同.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const output = new File(["output"], "登记结果.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    fireEvent.change(screen.getByLabelText("案例 1 的历史输入"), { target: { files: [input] } });
    fireEvent.change(screen.getByLabelText("案例 1 的最终输出"), { target: { files: [output] } });
    fireEvent.click(screen.getByRole("button", { name: "开始学习" }));

    await waitFor(() => expect(mocks.createTemplateLearningTask).toHaveBeenCalledWith({
      name: "",
      allowCloudOcr: true,
    }));
    expect(mocks.uploadTemplateLearningFile).toHaveBeenNthCalledWith(1, "learning-1", "case-1", "input", input);
    expect(mocks.uploadTemplateLearningFile).toHaveBeenNthCalledWith(2, "learning-1", "case-1", "output", output);
    expect(mocks.startTemplateLearningTask).toHaveBeenCalledWith("learning-1", { allowCloudOcr: true });
    expect(await screen.findByText(/系统正在后台整理/)).toBeTruthy();
  });

  it("explains when an image cannot be learned because local OCR is unavailable", async () => {
    mocks.getWorkflowOcrReadiness.mockResolvedValueOnce({
      state: "unavailable", providerId: null, reason: "workflow_ocr_platform_unsupported",
      localOnly: true, supportedExtensions: [".pdf", ".png", ".jpg", ".jpeg", ".webp"],
    });
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: /创建我的模板/ }));
    const input = new File(["image"], "客户询价.png", { type: "image/png" });
    const output = new File(["output"], "报价单.docx");
    fireEvent.change(screen.getByLabelText("案例 1 的历史输入"), { target: { files: [input] } });
    fireEvent.change(screen.getByLabelText("案例 1 的最终输出"), { target: { files: [output] } });

    expect(await screen.findByText(/图片需要文字识别/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "开始学习" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers automatic Codex recognition when local OCR is unavailable", async () => {
    mocks.getWorkflowOcrReadiness.mockResolvedValueOnce({
      state: "ready", providerId: "codex-vision", reason: null, localOnly: false,
      requiresCloudConsent: true,
      local: { state: "unavailable", providerId: null, reason: "workflow_ocr_platform_unsupported" },
      cloudFallback: { state: "ready", providerId: "codex-vision", reason: null },
      supportedExtensions: [".pdf", ".png", ".jpg", ".jpeg", ".webp"],
    });
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: /创建我的模板/ }));
    fireEvent.change(screen.getByLabelText("案例 1 的历史输入"), {
      target: { files: [new File(["image"], "客户询价.png", { type: "image/png" })] },
    });
    fireEvent.change(screen.getByLabelText("案例 1 的最终输出"), {
      target: { files: [new File(["output"], "报价单.xlsx")] },
    });

    expect(screen.getByText("本机无法识别时，自动使用 Codex AI")).toBeTruthy();
    expect(screen.getByText(/自动切换到 Codex AI 识别/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "开始学习" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("explains exactly which required file is still missing", async () => {
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: /创建我的模板/ }));

    expect(screen.getByText("请先选择历史输入和对应的最终输出。")).toBeTruthy();
    const input = new File(["input"], "客户需求.docx");
    fireEvent.change(screen.getByLabelText("案例 1 的历史输入"), { target: { files: [input] } });

    expect(screen.getByText("这组案例还缺对应的最终输出。")).toBeTruthy();
    expect((screen.getByRole("button", { name: "开始学习" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
