import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DailyWorkAutomationCard } from "@/features/workflow-memory/daily-work-automation-card";
import type { AdaptiveWorkWorkbench } from "@/features/workflow-memory/workflow-memory-api";
import { i18n } from "@/lib/i18n";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  automation: vi.fn(),
}));

vi.mock("@/features/workflow-memory/workflow-memory-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/workflow-memory/workflow-memory-api")>();
  return {
    ...actual,
    workflowMemoryApi: {
      ...actual.workflowMemoryApi,
      getAdaptiveWorkWorkbench: mocks.get,
      updateAdaptiveWorkAutomation: mocks.automation,
    },
  };
});

function workbench({ execute = false, monitor = false } = {}): AdaptiveWorkWorkbench {
  return {
    policy: {
      mode: execute ? "execute" : "observe",
      revision: 2,
      scope: "source",
      sourceId: "wfs_a",
      inheritedMode: null,
      updatedAt: null,
      updatedBy: null,
      boundary: { localIssueOnly: true, externalDelivery: false, overwriteFiles: false },
    },
    monitor: {
      id: monitor ? "awm_a" : null,
      sourceId: "wfs_a",
      enabled: monitor,
      intervalMinutes: 15,
      revision: 3,
      state: monitor ? "scheduled" : "disabled",
      nextRunAt: null,
      lastRunAt: null,
      lastSuccessAt: null,
      lastError: null,
      consecutiveFailures: 0,
      updatedAt: null,
    },
    suggestions: [],
    metrics: {
      total: 0,
      ready: 0,
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
    permissions: { canUse: true, canManage: true },
  };
}

function renderCard(learnedRoutineName: string | null = "处理客户询价") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DailyWorkAutomationCard
        projectId="prj_a"
        sourceId="wfs_a"
        learnedRoutineName={learnedRoutineName}
      />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("zh");
  mocks.get.mockReset().mockResolvedValue(workbench());
  mocks.automation.mockReset().mockResolvedValue({
    enabled: true,
    policy: workbench({ execute: true }).policy,
    monitor: workbench({ monitor: true }).monitor,
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DailyWorkAutomationCard", () => {
  it("keeps automatic handling disabled until a work type has been learned", async () => {
    renderCard(null);
    expect(await screen.findByText("系统还在学习这项工作。请先检查并启用识别出的工作类型。")).toBeTruthy();
    expect((screen.getByRole("button", { name: "以后按这个规矩处理" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables the one-time execute policy and folder monitor together", async () => {
    renderCard();
    const button = await screen.findByRole("button", { name: "以后按这个规矩处理" });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);

    await waitFor(() => expect(mocks.automation).toHaveBeenCalledWith({
      projectId: "prj_a",
      sourceId: "wfs_a",
      expectedPolicyRevision: 2,
      expectedMonitorRevision: 3,
      enabled: true,
      intervalMinutes: 15,
      confirmed: true,
    }));
    expect(mocks.automation).toHaveBeenCalledTimes(1);
  });

  it("shows the learned work and the few reasons AI may still ask for help", async () => {
    mocks.get.mockResolvedValue(workbench({ execute: true, monitor: true }));
    renderCard();
    expect(await screen.findByText("日常工作已自动处理")).toBeTruthy();
    expect(screen.getByText("处理客户询价")).toBeTruthy();
    expect(screen.getByText(/只有缺少或冲突的信息/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "暂停自动处理" })).toBeTruthy();
  });

  it("pauses monitoring and execution with the same single atomic action", async () => {
    mocks.get.mockResolvedValue(workbench({ execute: true, monitor: true }));
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "暂停自动处理" }));

    await waitFor(() => expect(mocks.automation).toHaveBeenCalledWith({
      projectId: "prj_a",
      sourceId: "wfs_a",
      expectedPolicyRevision: 2,
      expectedMonitorRevision: 3,
      enabled: false,
      intervalMinutes: 15,
    }));
    expect(mocks.automation).toHaveBeenCalledTimes(1);
  });

  it("shows a direct retry when the current status cannot be checked", async () => {
    mocks.get.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(workbench());
    renderCard();

    expect(await screen.findByText("暂时无法确认当前是否已经开启自动处理。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重新检查" }));
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
  });
});
