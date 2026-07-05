import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useUrlNavigationSync } from "@/app/url-navigation-sync";
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
  window.history.replaceState(null, "", "/");
  useUiStore.setState({
    section: "dashboard",
    selectedInvocationId: null,
    selectedApplicationId: null,
    selectedApplicationRun: null,
  });
});

describe("InvocationsView operator explanation", () => {
  it("routes server explanation actions to approval, result, and recovery timeline targets", async () => {
    apiMock.fetchState.mockResolvedValue(actionExplanationState());
    apiMock.getApplicationOrchestrationRunRecovery.mockResolvedValue({
      applicationId: "app_docs",
      routineId: "routine_docs_smoke",
      invocationId: "inv_action",
      recovery: {
        category: "validation_failed",
        confidence: 0.9,
        retryRecommended: false,
        humanApprovalRequired: true,
        summary: "Recovery is pending approval.",
        actions: [],
      },
    });

    useUiStore.setState({ section: "invocations", selectedInvocationId: "inv_action" });
    renderWithClient(createElement(NavigationSyncedInvocationsView));

    expect(await screen.findByText("Actionable explanation")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Open approval/i }));
    expect(useUiStore.getState().section).toBe("dashboard");
    expect(useUiStore.getState().selectedInvocationId).toBe("inv_action");
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("section")).toBe("dashboard"));
    expect(new URLSearchParams(window.location.search).get("invocation")).toBe("inv_action");

    useUiStore.setState({ section: "invocations", selectedInvocationId: "inv_action" });
    await waitFor(() => expect(screen.getByText("Actionable explanation")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /View result/i }));
    expect(useUiStore.getState().section).toBe("invocations");
    expect(useUiStore.getState().selectedInvocationId).toBe("inv_result");
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("invocation")).toBe("inv_result"));

    useUiStore.setState({ section: "invocations", selectedInvocationId: "inv_action" });
    await waitFor(() => expect(screen.getByText("Actionable explanation")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Open timeline/i }));
    expect(useUiStore.getState().section).toBe("applications");
    expect(useUiStore.getState().selectedApplicationId).toBe("app_docs");
    expect(useUiStore.getState().selectedApplicationRun).toEqual({
      applicationId: "app_docs",
      routineId: "routine_docs_smoke",
      invocationId: "inv_action",
    });
    await waitFor(() => {
      const params = new URLSearchParams(window.location.search);
      expect(params.get("section")).toBe("applications");
      expect(params.get("application")).toBe("app_docs");
      expect(params.get("routine")).toBe("routine_docs_smoke");
      expect(params.get("run")).toBe("inv_action");
    });
  });

  it("routes troubleshooting report and source links from server explanation", async () => {
    apiMock.fetchState.mockResolvedValue(actionExplanationState());

    useUiStore.setState({ section: "invocations", selectedInvocationId: "inv_report" });
    renderWithClient(createElement(InvocationsView));

    expect(await screen.findByText("Troubleshooting report is ready.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Open report/i }));
    expect(useUiStore.getState().section).toBe("invocations");
    expect(useUiStore.getState().selectedInvocationId).toBe("inv_failed");

    useUiStore.setState({ section: "invocations", selectedInvocationId: "inv_report" });
    await waitFor(() => expect(screen.getByText("Troubleshooting report is ready.")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /View source/i }));
    expect(useUiStore.getState().section).toBe("invocations");
    expect(useUiStore.getState().selectedInvocationId).toBe("inv_failed");
  });

  it("keeps explanation rows explicit when action targets are absent", async () => {
    apiMock.fetchState.mockResolvedValue(missingTargetExplanationState());

    useUiStore.setState({ section: "invocations", selectedInvocationId: "inv_missing_targets" });
    renderWithClient(createElement(InvocationsView));

    expect(await screen.findByText("Targets are missing from the snapshot.")).toBeTruthy();
    expect(screen.getByText("Approval target is not loaded.")).toBeTruthy();
    expect(screen.getByText("Result invocation is not loaded.")).toBeTruthy();
    expect(screen.getByText("Source invocation is not loaded.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Open approval/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /View result/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /View source/i })).toBeNull();

    useUiStore.setState({ section: "invocations", selectedInvocationId: "inv_missing_report" });
    await waitFor(() => expect(screen.getByText("Report target is missing from the snapshot.")).toBeTruthy());
    expect(screen.getByText("Troubleshooting report is not loaded.")).toBeTruthy();
    expect(screen.getByText("Source invocation is not loaded.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Open report/i })).toBeNull();
  });

  it("prefers server-provided invocation explanation shape", async () => {
    apiMock.fetchState.mockResolvedValue(serverExplanationState());

    useUiStore.setState({ selectedInvocationId: "inv_server_explained" });
    renderWithClient(createElement(InvocationsView));

    expect(await screen.findByText("Server-side explanation is authoritative.")).toBeTruthy();
    expect(screen.getAllByText("Scheduled automation").length).toBeGreaterThan(0);
    expect(screen.getByText("Policy gate is waiting for an operator.")).toBeTruthy();
    expect(screen.getByText("apr_server (pending)")).toBeTruthy();
    expect(screen.getByText("audit row")).toBeTruthy();
    expect(screen.getByText("Approve or deny from the approvals queue.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /View result/i })).toBeNull();
    expect(apiMock.getApplicationOrchestrationRunRecovery).not.toHaveBeenCalled();
  });

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

function actionExplanationState(): ConsoleSnapshot {
  return {
    namespace: "test",
    protocolVersion: "0.0.0",
    serverTime: "2026-07-05T08:00:00.000Z",
    device: {
      id: "dev_local",
      name: "Local bridge",
      status: "online",
      platform: "win32",
      architecture: "x64",
      lastSeenAt: "2026-07-05T08:00:00.000Z",
    },
    agent: null,
    agents: [],
    projects: [],
    worktrees: [],
    currentProjectId: "proj_docs",
    invocations: [{
      id: "inv_action",
      status: "failed",
      agentId: "agt_demo_cli",
      projectId: "proj_docs",
      explanation: {
        state: "failed",
        reason: "Validation failed.",
        reasonCode: "failed",
        summary: "Actionable explanation",
        waitingOn: {
          type: "approval",
          id: "apr_action",
          status: "pending",
          label: "apr_action (pending)",
        },
        resultLocation: {
          type: "invocation",
          invocationId: "inv_result",
          label: "inv_result",
        },
        nextAction: "Open the recovery timeline.",
        approval: {
          requestId: "apr_action",
          status: "pending",
        },
        recovery: {
          category: "validation_failed",
          actionType: "regenerate_orchestration",
          actionRequestId: "rec_action",
          status: "approval_pending",
          sourceInvocationId: "inv_action",
          approvalRequestId: "apr_action",
          resultInvocationId: "inv_result",
        },
        source: {
          type: "application_orchestration",
          applicationId: "app_docs",
          applicationName: "Docs",
          routineId: "routine_docs_smoke",
        },
      },
      options: {
        metadata: {
          source: "application_orchestration",
          applicationId: "app_docs",
          routineId: "routine_docs_smoke",
        },
      },
    }, {
      id: "inv_result",
      status: "queued",
      agentId: "agt_demo_cli",
      projectId: "proj_docs",
      options: { metadata: {} },
    }, {
      id: "inv_failed",
      status: "failed",
      agentId: "agt_demo_cli",
      projectId: "proj_docs",
      options: { metadata: {} },
    }, {
      id: "inv_report",
      status: "succeeded",
      agentId: "agt_platform_troubleshooter",
      projectId: "proj_docs",
      explanation: {
        state: "succeeded",
        reason: "Troubleshooter generated a report.",
        reasonCode: "succeeded",
        summary: "Troubleshooting report is ready.",
        resultLocation: {
          type: "troubleshooting_report",
          reportId: "trb_1",
          label: "trb_1",
        },
        nextAction: "Open the troubleshooting report.",
        source: {
          type: "troubleshooting",
          targetInvocationId: "inv_failed",
        },
      },
      options: {
        metadata: {
          targetInvocationId: "inv_failed",
        },
      },
    }],
    events: [],
    auditSummaries: [],
    approvalRequests: [{
      id: "apr_action",
      invocationId: "inv_action",
      status: "pending",
    }],
    applicationRecoveryActions: [{
      id: "rec_action",
      applicationId: "app_docs",
      routineId: "routine_docs_smoke",
      invocationId: "inv_action",
      actionType: "regenerate_orchestration",
      status: "approval_pending",
      recoveryCategory: "validation_failed",
      approvalRequestId: "apr_action",
      resultInvocationId: "inv_result",
      createdAt: "2026-07-05T08:00:00.000Z",
      updatedAt: "2026-07-05T08:01:00.000Z",
    }],
    troubleshootingReports: [{
      id: "trb_1",
      invocationId: "inv_failed",
      summary: "Troubleshooter reviewed inv_failed.",
      bridgeState: "online",
      logSummary: "No logs.",
    }],
  } as ConsoleSnapshot;
}

function NavigationSyncedInvocationsView() {
  useUrlNavigationSync();
  return createElement(InvocationsView);
}

function missingTargetExplanationState(): ConsoleSnapshot {
  return {
    namespace: "test",
    protocolVersion: "0.0.0",
    serverTime: "2026-07-05T08:00:00.000Z",
    device: {
      id: "dev_local",
      name: "Local bridge",
      status: "online",
      platform: "win32",
      architecture: "x64",
      lastSeenAt: "2026-07-05T08:00:00.000Z",
    },
    agent: null,
    agents: [],
    projects: [],
    worktrees: [],
    currentProjectId: "proj_docs",
    invocations: [{
      id: "inv_missing_targets",
      status: "failed",
      agentId: "agt_demo_cli",
      projectId: "proj_docs",
      explanation: {
        state: "failed",
        reason: "Missing related records.",
        reasonCode: "failed",
        summary: "Targets are missing from the snapshot.",
        waitingOn: {
          type: "approval",
          id: "apr_missing",
          status: "pending",
          label: "apr_missing (pending)",
        },
        resultLocation: {
          type: "invocation",
          invocationId: "inv_result_missing",
          label: "inv_result_missing",
        },
        nextAction: "Wait for the snapshot to include the target records.",
        approval: {
          requestId: "apr_missing",
          status: "pending",
        },
        source: {
          type: "recovery_result",
          invocationId: "inv_source_missing",
          recoveryActionRequestId: "rec_missing",
        },
      },
      options: { metadata: {} },
    }, {
      id: "inv_missing_report",
      status: "succeeded",
      agentId: "agt_platform_troubleshooter",
      projectId: "proj_docs",
      explanation: {
        state: "succeeded",
        reason: "Troubleshooter generated a report.",
        reasonCode: "succeeded",
        summary: "Report target is missing from the snapshot.",
        resultLocation: {
          type: "troubleshooting_report",
          reportId: "trb_missing",
          label: "trb_missing",
        },
        nextAction: "Wait for the troubleshooting report to appear.",
        source: {
          type: "troubleshooting",
          targetInvocationId: "inv_failed_missing",
        },
      },
      options: {
        metadata: {
          targetInvocationId: "inv_failed_missing",
        },
      },
    }],
    events: [],
    auditSummaries: [],
    approvalRequests: [],
    applicationRecoveryActions: [],
    troubleshootingReports: [],
  } as ConsoleSnapshot;
}

function serverExplanationState(): ConsoleSnapshot {
  return {
    namespace: "test",
    protocolVersion: "0.0.0",
    serverTime: "2026-07-05T08:00:00.000Z",
    device: {
      id: "dev_local",
      name: "Local bridge",
      status: "online",
      platform: "win32",
      architecture: "x64",
      lastSeenAt: "2026-07-05T08:00:00.000Z",
    },
    agent: null,
    agents: [],
    projects: [],
    worktrees: [],
    currentProjectId: "proj_docs",
    invocations: [{
      id: "inv_server_explained",
      status: "waiting_for_local_approval",
      agentId: "agt_demo_cli",
      projectId: "proj_docs",
      approvalRequestId: "apr_server",
      explanation: {
        state: "approval_pending",
        reason: "Policy gate is waiting for an operator.",
        reasonCode: "local_approval_pending",
        summary: "Server-side explanation is authoritative.",
        waitingOn: {
          type: "approval",
          id: "apr_server",
          status: "pending",
          label: "apr_server (pending)",
        },
        resultLocation: {
          type: "audit_summary",
          invocationId: "inv_server_explained",
          label: "audit row",
        },
        nextAction: "Approve or deny from the approvals queue.",
        approval: {
          requestId: "apr_server",
          status: "pending",
          riskLevel: "high",
        },
        source: {
          type: "automation",
          automationId: "atm_docs",
          automationName: "Docs audit",
          scheduled: true,
        },
      },
      options: {
        metadata: {
          automationId: "atm_docs",
          automationName: "Docs audit",
          scheduled: true,
        },
      },
    }],
    events: [],
    auditSummaries: [],
    approvalRequests: [{
      id: "apr_server",
      status: "pending",
    }],
  } as ConsoleSnapshot;
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
      approvalRequestId: "cdx_appr_original",
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
      id: "cdx_appr_original",
      status: "approved",
    }, {
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
