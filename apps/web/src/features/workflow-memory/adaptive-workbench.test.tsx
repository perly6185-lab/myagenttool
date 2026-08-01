import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdaptiveWorkbench } from "@/features/workflow-memory/adaptive-workbench";
import type { AdaptiveWorkWorkbench } from "@/features/workflow-memory/workflow-memory-api";
import { i18n } from "@/lib/i18n";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  policy: vi.fn(),
  materialize: vi.fn(),
  feedback: vi.fn(),
  reconcile: vi.fn(),
  monitor: vi.fn(),
  runMonitor: vi.fn(),
  learning: vi.fn(),
  generate: vi.fn(),
  evaluate: vi.fn(),
  previewPublication: vi.fn(),
  publish: vi.fn(),
  rollback: vi.fn(),
  notifications: vi.fn(),
  readNotification: vi.fn(),
  shadowPreference: vi.fn(),
}));

vi.mock("@/features/workflow-memory/workflow-memory-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/workflow-memory/workflow-memory-api")>();
  return {
    ...actual,
    workflowMemoryApi: {
      ...actual.workflowMemoryApi,
      getAdaptiveWorkWorkbench: mocks.get,
      updateAdaptiveWorkPolicy: mocks.policy,
      materializeAdaptiveWorkSuggestion: mocks.materialize,
      recordAdaptiveWorkFeedback: mocks.feedback,
      reconcileAdaptiveWork: mocks.reconcile,
      updateAdaptiveWorkMonitor: mocks.monitor,
      runAdaptiveWorkMonitorNow: mocks.runMonitor,
      getAdaptiveLearning: mocks.learning,
      generateAdaptiveLearningDraft: mocks.generate,
      evaluateAdaptiveLearning: mocks.evaluate,
      previewAdaptiveLearningPublication: mocks.previewPublication,
      publishAdaptiveLearningDraft: mocks.publish,
      rollbackAdaptiveLearningRule: mocks.rollback,
      getAdaptiveNotifications: mocks.notifications,
      readAdaptiveNotification: mocks.readNotification,
      recordAdaptiveShadowPreference: mocks.shadowPreference,
    },
  };
});

function response(mode: AdaptiveWorkWorkbench["policy"]["mode"] = "observe"): AdaptiveWorkWorkbench {
  return {
    policy: {
      mode,
      revision: 0,
      scope: "inherited",
      sourceId: "wfs_a",
      inheritedMode: "observe",
      updatedAt: null,
      updatedBy: null,
      boundary: { localIssueOnly: true, externalDelivery: false, overwriteFiles: false },
    },
    permissions: { canUse: true, canManage: true },
    monitor: {
      id: null,
      sourceId: "wfs_a",
      enabled: false,
      intervalMinutes: 15,
      revision: 0,
      state: "disabled",
      nextRunAt: null,
      lastRunAt: null,
      lastSuccessAt: null,
      lastError: null,
      consecutiveFailures: 0,
      updatedAt: null,
    },
    metrics: {
      total: 1,
      ready: 1,
      needsAttention: 0,
      materialized: 0,
      automationEligible: 0,
      accepted: 0,
      rejected: 0,
      acceptanceRate: null,
      tracked: 0,
      completed: 0,
      completionRate: null,
    },
    suggestions: [{
      id: "aws_1",
      projectId: "prj_a",
      sourceId: "wfs_a",
      observationId: "wio_1",
      artifact: { id: "wfa_1", name: "RFQ-101.xlsx", family: "spreadsheet", extension: "xlsx" },
      documentType: "inquiry",
      detectedDocumentType: "inquiry",
      confidence: 0.96,
      confirmationState: "confirmed",
      readiness: "ready",
      reasons: ["文件内容被识别为 inquiry", "文件类型已经人工确认"],
      riskSignals: [],
      actions: ["核对询价信息", "生成报价单", "更新询价台账", "更新报价台账"],
      history: [{
        classificationId: "bdc_old",
        documentType: "inquiry",
        artifact: { id: "wfa_old", name: "RFQ-100.xlsx", family: "spreadsheet", extension: "xlsx" },
        confirmationState: "confirmed",
      }],
      automation: {
        eligible: false,
        confidenceThreshold: 0.9,
        historyThreshold: 3,
        reasons: ["insufficient_confirmed_history"],
      },
      issue: null,
      learnedRule: null,
      outcome: null,
      shadow: null,
      feedback: null,
    }],
  };
}

function renderWorkbench(onOpenTask = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    onOpenTask,
    ...render(
      <QueryClientProvider client={client}>
        <AdaptiveWorkbench projectId="prj_a" sourceId="wfs_a" onOpenTask={onOpenTask} />
      </QueryClientProvider>,
    ),
  };
}

beforeEach(async () => {
  await i18n.changeLanguage("zh");
  mocks.get.mockReset().mockResolvedValue(response());
  mocks.policy.mockReset().mockResolvedValue({ policy: { ...response().policy, mode: "assist", revision: 1 } });
  mocks.materialize.mockReset().mockResolvedValue({
    workItem: { id: "lwi_1", localRef: "LOCAL-1", title: "核对询价", status: "ready" },
    replayed: false,
    workbench: response(),
  });
  mocks.feedback.mockReset().mockResolvedValue({ feedback: {}, workbench: response() });
  mocks.reconcile.mockReset().mockResolvedValue({
    mode: "observe", observed: 1, prepared: 1, autoCreated: 0,
    created: [], failures: [], capped: false, workbench: response(),
  });
  mocks.monitor.mockReset().mockResolvedValue({ monitor: { ...response().monitor, enabled: true, revision: 1 } });
  mocks.runMonitor.mockReset().mockResolvedValue({ result: { status: "succeeded" } });
  mocks.learning.mockReset().mockResolvedValue({
    readiness: {
      evidenceCount: 0, accepted: 0, rejected: 0,
      draftRequired: 3, evaluationRequired: 5,
      canGenerate: false, canEvaluate: false,
    },
    drafts: [],
    rules: [],
  });
  mocks.generate.mockReset().mockResolvedValue({ draft: {} });
  mocks.evaluate.mockReset().mockResolvedValue({ evaluation: {}, governance: {} });
  mocks.previewPublication.mockReset().mockResolvedValue({
    review: {
      draftId: "draft_1",
      draftVersion: 1,
      draftRevision: 2,
      fingerprint: "review-fingerprint-1",
      gate: {
        passed: true,
        reasons: [],
        evaluation: {
          evidenceCount: 5, accepted: 5, rejected: 0, acceptanceRate: 1,
          completionRate: null, representative: true, passed: true, reasons: [],
        },
      },
      evidence: { count: 5, ids: ["awf_1", "awf_2", "awf_3", "awf_4", "awf_5"] },
      changes: [{
        documentType: "inquiry",
        before: null,
        after: { actions: ["核对询价信息"], confidenceThreshold: 0.9 },
        actionChanges: { added: ["核对询价信息"], removed: [] },
      }],
      typeMappings: [],
      impact: {
        observedSuggestions: 1, affectedSuggestions: 1,
        automationEligible: 0, executeMode: false,
      },
      rollback: { available: false, ruleId: null, version: null },
      boundary: {
        candidateAppliedBeforePublish: false,
        localIssueOnly: true,
        externalDelivery: false,
      },
    },
  });
  mocks.publish.mockReset().mockResolvedValue({ rule: {} });
  mocks.rollback.mockReset().mockResolvedValue({ activeRule: {} });
  mocks.notifications.mockReset().mockResolvedValue({ notifications: [], unread: 0 });
  mocks.readNotification.mockReset().mockResolvedValue({ notification: {} });
  mocks.shadowPreference.mockReset().mockResolvedValue({ comparison: {}, draftRevision: 3 });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AdaptiveWorkbench", () => {
  it("shows explainable actions, history, and the local-only boundary", async () => {
    renderWorkbench();
    expect(screen.getByText("岗位助手")).toBeTruthy();
    expect(await screen.findByText("RFQ-101.xlsx")).toBeTruthy();
    expect(screen.getByText(/生成报价单/)).toBeTruthy();
    expect(screen.getByText(/RFQ-100\.xlsx/)).toBeTruthy();
    expect(screen.getByText(/不会自动外发、覆盖文件或修改原始资料/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "确认并创建本地 Issue" }).hasAttribute("disabled")).toBe(true);
  });

  it("updates the assistance policy with revision protection", async () => {
    renderWorkbench();
    const select = await screen.findByLabelText("协助级别");
    fireEvent.change(select, { target: { value: "assist" } });
    await waitFor(() => expect(mocks.policy).toHaveBeenCalledWith({
      projectId: "prj_a",
      sourceId: "wfs_a",
      expectedRevision: 0,
      mode: "assist",
    }));
  });

  it("confirms, creates one local Issue, and opens the task", async () => {
    mocks.get.mockResolvedValue(response("assist"));
    const { onOpenTask } = renderWorkbench();
    fireEvent.click(await screen.findByRole("button", { name: "确认并创建本地 Issue" }));
    await waitFor(() => expect(mocks.materialize).toHaveBeenCalledWith("aws_1", {
      projectId: "prj_a",
      sourceId: "wfs_a",
      confirmed: true,
    }));
    expect(window.confirm).toHaveBeenCalled();
    expect(onOpenTask).toHaveBeenCalledWith("lwi_1");
  });

  it("records explicit usefulness feedback", async () => {
    renderWorkbench();
    fireEvent.change(await screen.findByLabelText("反馈原因"), {
      target: { value: "wrong_document_type" },
    });
    fireEvent.click(screen.getByRole("checkbox", {
      name: "我确认以上纠正符合实际工作方式。",
    }));
    expect(screen.getByRole("button", { name: "不合适" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("正确的文件类型"), {
      target: { value: "price_list" },
    });
    fireEvent.click(screen.getByRole("checkbox", {
      name: "我确认以上纠正符合实际工作方式。",
    }));
    fireEvent.click(await screen.findByRole("button", { name: "不合适" }));
    await waitFor(() => expect(mocks.feedback).toHaveBeenCalledWith("aws_1", {
      projectId: "prj_a",
      sourceId: "wfs_a",
      decision: "rejected",
      reason: "wrong_document_type",
      correctedDocumentType: "price_list",
      correctedActions: ["核对价格表版本", "将价格表作为报价参考资料"],
      correctionConfirmed: true,
    }));
  });

  it("runs a bounded manual reconciliation for the current folder", async () => {
    renderWorkbench();
    fireEvent.click(await screen.findByRole("button", { name: "立即协调" }));
    await waitFor(() => expect(mocks.reconcile).toHaveBeenCalledWith({
      projectId: "prj_a",
      sourceId: "wfs_a",
    }));
  });

  it("enables confirmed background monitoring with the selected interval", async () => {
    renderWorkbench();
    fireEvent.change(await screen.findByLabelText("扫描间隔"), { target: { value: "30" } });
    await waitFor(() => expect(mocks.monitor).toHaveBeenCalledWith({
      projectId: "prj_a",
      sourceId: "wfs_a",
      expectedRevision: 0,
      enabled: false,
      intervalMinutes: 30,
    }));
    fireEvent.click(screen.getByRole("button", { name: "监控已关闭" }));
    await waitFor(() => expect(mocks.monitor).toHaveBeenLastCalledWith({
      projectId: "prj_a",
      sourceId: "wfs_a",
      expectedRevision: 0,
      enabled: true,
      intervalMinutes: 15,
      confirmed: true,
    }));
  });

  it("shows shadow governance and publishes only a passed draft", async () => {
    mocks.learning.mockResolvedValue({
      readiness: {
        evidenceCount: 5, accepted: 5, rejected: 0,
        draftRequired: 3, evaluationRequired: 5,
        canGenerate: true, canEvaluate: true,
      },
      drafts: [{
        id: "draft_1", version: 1, revision: 2, status: "shadow",
        evaluation: {
          evidenceCount: 5, accepted: 5, rejected: 0, acceptanceRate: 1,
          completionRate: null, representative: true, passed: true, reasons: [],
        },
        configuration: { documentTypes: [] },
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      }],
      rules: [],
    });
    renderWorkbench();
    const publish = await screen.findByRole("button", { name: "发布通过门禁的草稿" });
    expect(publish.hasAttribute("disabled")).toBe(true);
    const preview = screen.getByRole("button", { name: "生成发布评审" });
    await waitFor(() => expect(preview.hasAttribute("disabled")).toBe(false));
    fireEvent.click(preview);
    await waitFor(() => expect(mocks.previewPublication).toHaveBeenCalledWith("draft_1"));
    expect(await screen.findByTestId("adaptive-publication-review")).toBeTruthy();
    expect(screen.getByText(/候选规则尚未生效/)).toBeTruthy();
    await waitFor(() => expect(publish.hasAttribute("disabled")).toBe(false));
    fireEvent.click(publish);
    await waitFor(() => expect(mocks.publish).toHaveBeenCalledWith("draft_1", {
      expectedRevision: 2,
      reviewFingerprint: "review-fingerprint-1",
      confirmed: true,
    }));
  });

  it("compares current and candidate results without applying the candidate", async () => {
    const workbench = response();
    workbench.suggestions[0].shadow = {
      id: "awsc_1",
      draftId: "draft_1",
      draftVersion: 1,
      suggestionId: "aws_1",
      baseline: {
        documentType: "inquiry",
        actions: ["核对询价信息"],
        confidenceThreshold: 0.9,
      },
      candidate: {
        documentType: "price_list",
        actions: ["核对价格表版本"],
        confidenceThreshold: 0.95,
      },
      differences: {
        documentTypeChanged: true,
        actionsChanged: true,
        thresholdChanged: true,
      },
      preference: null,
      evaluatedAt: null,
    };
    mocks.get.mockResolvedValue(workbench);
    mocks.learning.mockResolvedValue({
      readiness: {
        evidenceCount: 5, accepted: 4, rejected: 1,
        draftRequired: 3, evaluationRequired: 5,
        canGenerate: true, canEvaluate: true,
      },
      drafts: [{
        id: "draft_1", version: 1, revision: 2, status: "shadow",
        evaluation: {
          evidenceCount: 5, accepted: 4, rejected: 1, acceptanceRate: 0.8,
          completionRate: null, representative: true, passed: false, reasons: [],
        },
        configuration: { documentTypes: [] },
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      }],
      rules: [],
    });
    renderWorkbench();
    expect(await screen.findByText("影子对比（不会影响实际工作）")).toBeTruthy();
    expect(screen.getByText(/核对价格表版本/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "候选结果更好" }));
    await waitFor(() => expect(mocks.shadowPreference).toHaveBeenCalledWith(
      "draft_1",
      "aws_1",
      {
        expectedRevision: 2,
        preferred: "candidate",
        reason: "better_matches_actual_work",
        confirmed: true,
      },
    ));
  });

  it("shows learning readiness and runs an enabled monitor immediately", async () => {
    const enabled = response();
    enabled.monitor = { ...enabled.monitor!, id: "awm_1", enabled: true, state: "scheduled", revision: 1 };
    mocks.get.mockResolvedValue(enabled);
    renderWorkbench();
    expect(await screen.findByText(/学习准备度：0\/3 条反馈样本/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "生成学习草稿" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "立即检查目录" }));
    await waitFor(() => expect(mocks.runMonitor).toHaveBeenCalledWith({
      projectId: "prj_a",
      sourceId: "wfs_a",
    }));
  });
});
