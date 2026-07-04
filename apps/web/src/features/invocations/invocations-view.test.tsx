import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InvocationsView } from "@/features/invocations/invocations-view";
import { useUiStore } from "@/store/ui-store";
import type { ConsoleSnapshot } from "@/lib/console-state";

const apiMock = vi.hoisted(() => ({
  fetchState: vi.fn(),
  getApplicationOrchestrationRunRecovery: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  fetchState: apiMock.fetchState,
  api: {
    getApplicationOrchestrationRunRecovery: apiMock.getApplicationOrchestrationRunRecovery,
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useUiStore.setState({
    section: "dashboard",
    selectedInvocationId: null,
  });
});

describe("InvocationsView operator explanation", () => {
  it("renders application recovery explanation for the selected invocation", async () => {
    apiMock.fetchState.mockResolvedValue(consoleState());
    apiMock.getApplicationOrchestrationRunRecovery.mockResolvedValue({
      applicationId: "app_docs",
      routineId: "routine_docs_smoke",
      invocationId: "inv_failed",
      recovery: {
        category: "validation_failed",
        confidence: 0.9,
        retryRecommended: false,
        humanApprovalRequired: true,
        summary: "The routine failed validation; regenerate the orchestration.",
        actions: [{
          type: "regenerate_orchestration",
          label: "Regenerate orchestration",
          description: "Create a fresh governed orchestration draft.",
          requiresApproval: true,
          recommended: true,
          riskLevel: "high",
          availability: {
            state: "blocked",
            blockedReason: "same_action_approval_pending",
            latestRequestId: "app_rec_pending",
          },
        }],
      },
    });

    useUiStore.setState({ selectedInvocationId: "inv_failed" });
    renderWithClient(createElement(InvocationsView));

    expect(await screen.findByText("Operator explanation")).toBeTruthy();
    expect(screen.getByText("Waiting for approval")).toBeTruthy();
    expect(screen.getAllByText("Duplicate approval pending").length).toBeGreaterThan(0);
    expect(screen.getByText("Resolve the linked approval request before this recovery can execute.")).toBeTruthy();
    expect(screen.getByText("cdx_appr_pending (pending approval)")).toBeTruthy();
    expect(screen.getAllByText("inv_result").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /View result/i })).toBeTruthy();
    expect(screen.getByText(/Regenerate orchestration/)).toBeTruthy();

    await waitFor(() => {
      expect(apiMock.getApplicationOrchestrationRunRecovery).toHaveBeenCalledWith(
        "app_docs",
        "routine_docs_smoke",
        "inv_failed",
      );
    });
  });

  it("renders executed recovery result and follows the result link", async () => {
    apiMock.fetchState.mockResolvedValue(consoleState());
    apiMock.getApplicationOrchestrationRunRecovery.mockResolvedValue({
      applicationId: "app_docs",
      routineId: "routine_docs_smoke",
      invocationId: "inv_executed",
      recovery: {
        category: "runtime_error",
        confidence: 0.8,
        retryRecommended: true,
        humanApprovalRequired: false,
        summary: "The recovery rerun completed.",
        actions: [],
      },
    });

    useUiStore.setState({ selectedInvocationId: "inv_executed" });
    renderWithClient(createElement(InvocationsView));

    expect(await screen.findByText("Executed")).toBeTruthy();
    expect(screen.getAllByText("Execution completed").length).toBeGreaterThan(0);
    expect(screen.getByText("Recovery action executed.")).toBeTruthy();
    expect(screen.getByText("Inspect the recovery result invocation.")).toBeTruthy();
    expect(screen.getByText("Re-run · executed")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /View result/i }));
    expect(await screen.findByText("Timeline · inv_result_done")).toBeTruthy();
  });
});

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function consoleState(): ConsoleSnapshot {
  return {
    namespace: "test",
    protocolVersion: "0.0.0",
    serverTime: "2026-07-04T08:00:00.000Z",
    device: {
      id: "dev_local",
      name: "Local bridge",
      status: "online",
      platform: "win32",
      architecture: "x64",
      lastSeenAt: "2026-07-04T08:00:00.000Z",
      unlinkState: "linked",
    },
    agent: null,
    agents: [],
    projects: [],
    worktrees: [],
    currentProjectId: "proj_docs",
    invocations: [{
      id: "inv_failed",
      status: "failed",
      agentId: "agt_demo_cli",
      projectId: "proj_docs",
      worktreeId: "wt_docs",
      approvalRequestId: "cdx_appr_pending",
      result: { summary: "Routine validation failed." },
      options: {
        metadata: {
          source: "application_orchestration",
          applicationId: "app_docs",
          applicationName: "Docs",
          routineId: "routine_docs_smoke",
          orchestrationRelativePath: ".myagenttool/applications/app_docs/routine_docs_smoke.json",
        },
      },
    }, {
      id: "inv_executed",
      status: "failed",
      agentId: "agt_demo_cli",
      projectId: "proj_docs",
      worktreeId: "wt_docs",
      result: { summary: "Initial routine execution failed." },
      options: {
        metadata: {
          source: "application_orchestration",
          applicationId: "app_docs",
          applicationName: "Docs",
          routineId: "routine_docs_smoke",
          orchestrationRelativePath: ".myagenttool/applications/app_docs/routine_docs_smoke.json",
        },
      },
    }, {
      id: "inv_result",
      status: "queued",
      agentId: "agt_platform_application_control",
    }, {
      id: "inv_result_done",
      status: "succeeded",
      agentId: "agt_demo_cli",
      result: { summary: "Recovered run succeeded." },
    }],
    events: [],
    spans: [],
    traces: [],
    auditSummaries: [],
    budgets: [],
    automations: [],
    compareRuns: [],
    applications: [],
    tools: [],
    capabilities: [],
    approvalRequests: [{
      id: "cdx_appr_pending",
      status: "pending",
    }],
    applicationRecoveryActions: [{
      id: "app_rec_pending",
      applicationId: "app_docs",
      routineId: "routine_docs_smoke",
      invocationId: "inv_failed",
      actionType: "regenerate_orchestration",
      status: "approval_pending",
      recoveryCategory: "validation_failed",
      requiresApproval: true,
      approvalRequestId: "cdx_appr_pending",
      resultInvocationId: "inv_result",
      createdAt: "2026-07-04T08:00:00.000Z",
      updatedAt: "2026-07-04T08:01:00.000Z",
      explanation: {
        selectedAction: "regenerate_orchestration",
        state: "approval_pending",
        reason: "same_action_approval_pending",
        summary: "A matching recovery request is already waiting for approval.",
        nextStep: "Resolve the linked approval request before this recovery can execute.",
        approvalRequestId: "cdx_appr_pending",
        latestRequestId: "app_rec_pending",
        resultInvocationId: "inv_result",
      },
    }, {
      id: "app_rec_executed",
      applicationId: "app_docs",
      routineId: "routine_docs_smoke",
      invocationId: "inv_executed",
      actionType: "rerun",
      status: "executed",
      recoveryCategory: "runtime_error",
      resultInvocationId: "inv_result_done",
      createdAt: "2026-07-04T08:02:00.000Z",
      updatedAt: "2026-07-04T08:03:00.000Z",
      outcome: {
        state: "recovered",
        reason: "result_succeeded",
        severity: "success",
        summary: "Recovered run succeeded.",
        nextStep: "Inspect the recovery result invocation.",
      },
      explanation: {
        selectedAction: "rerun",
        state: "executed",
        reason: "execution_completed",
        summary: "Recovery action executed.",
        nextStep: "Inspect the recovery result invocation.",
        recoveryActionRequestId: "app_rec_executed",
        resultInvocationId: "inv_result_done",
      },
    }],
  } as ConsoleSnapshot;
}
