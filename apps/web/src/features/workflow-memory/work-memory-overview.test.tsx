import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkMemoryOverview } from "@/features/workflow-memory/work-memory-overview";
import type { WorkflowMemoryInsights } from "@/features/workflow-memory/workflow-memory-api";
import { i18n } from "@/lib/i18n";

const mocks = vi.hoisted(() => ({ get: vi.fn(), rollback: vi.fn() }));

vi.mock("@/features/workflow-memory/workflow-memory-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/workflow-memory/workflow-memory-api")>();
  return {
    ...actual,
    workflowMemoryApi: {
      ...actual.workflowMemoryApi,
      getWorkflowMemoryInsights: mocks.get,
      rollbackAdaptiveLearningRule: mocks.rollback,
    },
  };
});

const insights: WorkflowMemoryInsights = {
  pathGraph: {
    nodes: [
      { kind: "entry", state: "confirmed", paths: [{ path: "incoming" }] },
      { kind: "reference", state: "confirmed", paths: [{ path: "references" }] },
      { kind: "intermediate", state: "confirmed", paths: [{ path: "working" }] },
      { kind: "final", state: "confirmed", paths: [{ path: "deliveries" }] },
      { kind: "ledger", state: "confirmed", paths: [{ path: "ledgers" }] },
    ],
    unknownKinds: [],
  },
  health: {
    score: 72,
    status: "watch",
    reasons: ["manual_correction_rate_high"],
    metrics: { sampleCount: 8, duplicateRate: 0, manualCorrectionRate: 0.25, completionRate: 0.9, anomalyRate: 0 },
  },
  memoryPackage: {
    version: 3,
    summary: { trigger: { state: "confirmed", value: { documentTypes: ["contract_review"] } } },
  },
  previousMemoryPackage: { version: 2 },
  packageDiff: {
    changes: [{ path: "/summary/output/value/directories", kind: "changed", before: ["drafts"], after: ["deliveries"] }],
  },
  routineSelection: { state: "matched", routineDefinitionId: "routine_3", count: 1 },
  resultSuggestions: [{
    id: "draft_4:contract_review",
    documentType: "contract_review",
    evidenceCount: 4,
    changes: { added: ["核对付款条款"], removed: [], thresholdChanged: false },
    evaluationPassed: true,
  }],
  rollback: { available: true, ruleId: "rule_3", expectedRevision: 5 },
};

function renderOverview() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WorkMemoryOverview projectId="prj_a" sourceId="wfs_a" routineDefinitionId="routine_3" routineName="合同审查" />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
  mocks.get.mockReset().mockResolvedValue(insights);
  mocks.rollback.mockReset().mockResolvedValue({ activeRule: { id: "rule_2" } });
});

afterEach(() => cleanup());

describe("WorkMemoryOverview", () => {
  it("shows a concise status while the work memory is loading", () => {
    mocks.get.mockReturnValue(new Promise(() => {}));
    renderOverview();
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByText("正在整理这项工作的历史做法…")).toBeTruthy();
    expect(screen.getByText("正在核对工作路径、完成要求和最近结果。")).toBeTruthy();
  });

  it("maps evidence-backed insights to a plain-language work memory view", async () => {
    renderOverview();
    expect(await screen.findByText("这项工作会怎样处理")).toBeTruthy();
    expect(screen.getAllByText("合同审查", { selector: "p" }).length).toBeGreaterThan(0);
    expect(screen.getByText("最近人工修改结果的次数偏多。")).toBeTruthy();
    expect(screen.getByText("结果保存位置")).toBeTruthy();
    expect(screen.getByText("核对付款条款")).toBeTruthy();
  });

  it("explains a query failure and successfully retries", async () => {
    mocks.get
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(insights);
    renderOverview();
    expect(await screen.findByText("暂时无法查看这套工作规矩。你的任务和文件没有受到影响。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(await screen.findByText("这项工作会怎样处理")).toBeTruthy();
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });

  it("does not silently disappear when the returned memory is incomplete", async () => {
    mocks.get.mockResolvedValue({ ...insights, memoryPackage: null });
    renderOverview();
    expect(await screen.findByText("工作记录还没有整理完整，暂时不能按这套规矩自动处理。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重新加载" })).toBeTruthy();
    expect(screen.queryByText("这项工作会怎样处理")).toBeNull();
  });

  it("shows the same recovery when the work path is incomplete", async () => {
    mocks.get.mockResolvedValue({
      ...insights,
      pathGraph: {
        ...insights.pathGraph!,
        nodes: insights.pathGraph!.nodes.filter((node) => node.kind !== "final"),
      },
    });
    renderOverview();
    expect(await screen.findByText("工作记录还没有整理完整，暂时不能按这套规矩自动处理。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重新加载" })).toBeTruthy();
  });

  it("restores the previous learned rule only after the card confirmation", async () => {
    renderOverview();
    await screen.findByText("第 3 版");
    fireEvent.click(screen.getByRole("button", { name: "恢复上一次的规矩" }));
    fireEvent.click(screen.getByRole("button", { name: "确认恢复上一次" }));
    await waitFor(() => expect(mocks.rollback).toHaveBeenCalledWith("rule_3", {
      expectedRevision: 5,
      confirmed: true,
    }));
  });
});
