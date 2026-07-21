import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApplicationsInspector, latestRoutineInvocation } from "@/features/applications/applications-inspector";
import {
  readableRecoveryActionAvailabilityReason,
  readableRecoveryActionType,
  readableRecoveryAgentReason,
  readableRecoveryExplanationReason,
  readableRecoveryExplanationState,
  readableRecoveryOutcome,
  readableRecoveryOutcomeReason,
  readableRecoveryTimelineStatus,
} from "@/features/recovery/application-recovery-ui";
import { useUiStore } from "@/store/ui-store";
import type { ApplicationOrchestrationRecoveryAgentCandidate, ConsoleSnapshot, InvocationSnapshot } from "@/lib/console-state";

const apiMock = vi.hoisted(() => ({
  fetchState: vi.fn(),
  listApplicationCapabilities: vi.fn(),
  listApplicationOrchestrationRuns: vi.fn(),
  getApplicationOrchestrationRun: vi.fn(),
  listApplicationOrchestrationRunEvents: vi.fn(),
  getApplicationOrchestrationRunRecovery: vi.fn(),
  listApplicationOrchestrationRecoveryAgentCandidates: vi.fn(),
  requestApplicationOrchestrationRecoveryAction: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  fetchState: apiMock.fetchState,
  api: {
    listApplicationCapabilities: apiMock.listApplicationCapabilities,
    listApplicationOrchestrationRuns: apiMock.listApplicationOrchestrationRuns,
    getApplicationOrchestrationRun: apiMock.getApplicationOrchestrationRun,
    listApplicationOrchestrationRunEvents: apiMock.listApplicationOrchestrationRunEvents,
    getApplicationOrchestrationRunRecovery: apiMock.getApplicationOrchestrationRunRecovery,
    listApplicationOrchestrationRecoveryAgentCandidates: apiMock.listApplicationOrchestrationRecoveryAgentCandidates,
    requestApplicationOrchestrationRecoveryAction: apiMock.requestApplicationOrchestrationRecoveryAction,
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
  useUiStore.setState({
    section: "dashboard",
    selectedApplicationId: null,
    selectedInvocationId: null,
    selectedApplicationRun: null,
  });
});

function mockClipboard() {
  const writeText = vi.fn();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

describe("latestRoutineInvocation", () => {
  it("selects the newest matching application orchestration invocation", () => {
    const invocations = [
      invocation("inv_new", "app_docs", "routine_docs_smoke"),
      invocation("inv_other_routine", "app_docs", "routine_docs_lint"),
      invocation("inv_other_app", "app_blog", "routine_docs_smoke"),
      invocation("inv_old", "app_docs", "routine_docs_smoke"),
    ];

    expect(latestRoutineInvocation(invocations, "app_docs", "routine_docs_smoke")?.id).toBe("inv_new");
  });

  it("ignores invocations without application orchestration metadata", () => {
    const invocations = [
      {
        id: "inv_manual",
        options: { metadata: { applicationId: "app_docs", routineId: "routine_docs_smoke" } },
      },
    ] satisfies InvocationSnapshot[];

    expect(latestRoutineInvocation(invocations, "app_docs", "routine_docs_smoke")).toBeNull();
  });
});

describe("readableRecoveryAgentReason", () => {
  it("renders governed select-agent rejection reasons", () => {
    expect(readableRecoveryAgentReason("application_control_missing")).toBe("missing application control");
    expect(readableRecoveryAgentReason("device_unlinked")).toBe("device unlinked");
    expect(readableRecoveryAgentReason("custom_reason")).toBe("custom_reason");
  });
});

describe("recovery lineage labels", () => {
  it("renders recovery action and outcome labels", () => {
    expect(readableRecoveryActionType("select_agent")).toBe("Select agent");
    expect(readableRecoveryActionType("custom_action")).toBe("custom_action");
    expect(readableRecoveryActionAvailabilityReason("same_action_in_progress")).toBe("Already in progress");
    expect(readableRecoveryActionAvailabilityReason("custom_reason")).toBe("custom_reason");
    expect(readableRecoveryOutcome("still_failed")).toBe("Still failed");
    expect(readableRecoveryOutcome("custom_state")).toBe("custom_state");
    expect(readableRecoveryOutcomeReason("result_failed")).toBe("Result failed");
    expect(readableRecoveryOutcomeReason("custom_reason")).toBe("custom_reason");
    expect(readableRecoveryExplanationState("approval_pending")).toBe("Waiting for approval");
    expect(readableRecoveryExplanationState("custom_state")).toBe("custom_state");
    expect(readableRecoveryExplanationReason("same_action_approval_pending")).toBe("Duplicate approval pending");
    expect(readableRecoveryExplanationReason("result_failed")).toBe("Result failed");
    expect(readableRecoveryTimelineStatus("approval_pending")).toBe("Approval pending");
    expect(readableRecoveryTimelineStatus("custom_status")).toBe("custom_status");
  });
});

describe("ApplicationsInspector recovery guidance", () => {
  it("renders readiness only for this computer", async () => {
    const state = closedLoopConsoleState();
    state.applications = [{ id: "app_git", name: "Git", kind: "binary", status: "active", source: { type: "binary", binary: "git" } }];
    state.devices = [
      { id: "dev_a", name: "Laptop", status: "online", platform: "windows", architecture: "x64", lastSeenAt: "2026-07-14T00:00:00Z", applicationBinaryReadiness: [{ command: "git", capabilityPrefix: "app.app_git.wrapper.", status: "absent", version: null, checkedAt: "2026-07-14T00:00:00Z" }] },
      { id: "dev_b", name: "Build Mac", status: "offline", platform: "macos", architecture: "arm64", lastSeenAt: "2026-07-13T00:00:00Z", applicationBinaryReadiness: [{ command: "git", capabilityPrefix: "app.app_git.wrapper.", status: "stale", version: "git version 2.50", checkedAt: "2026-07-13T00:00:00Z" }] },
    ];
    state.device = state.devices[0];
    apiMock.fetchState.mockResolvedValue(state);
    apiMock.listApplicationCapabilities.mockResolvedValue({ applicationId: "app_git", capabilities: [] });
    useUiStore.setState({ selectedApplicationId: "app_git" });
    renderWithClient(createElement(ApplicationsInspector));
    expect(await screen.findByText(/^absent/)).toBeTruthy();
    expect(screen.queryByText(/Build Mac: stale/)).toBeNull();
  });

  it("renders the application discover to result loop and opens the result invocation", async () => {
    apiMock.fetchState.mockResolvedValue(closedLoopConsoleState());
    apiMock.listApplicationCapabilities.mockResolvedValue({
      applicationId: "app_ccusage",
      capabilities: [{
        name: "app.app_ccusage.wrapper.daily",
        displayName: "ccusage Daily Report",
        riskLevel: "low",
        status: "available",
        requiresApproval: false,
        metadata: {
          readiness: { state: "ready", reason: "wrapper_installed", executionMode: "bridge_wrapper" },
          resultPath: { outputCollection: "importedUsageEstimates", evidenceCenter: true },
        },
      }],
    });

    useUiStore.setState({ selectedApplicationId: "app_ccusage" });
    renderWithClient(createElement(ApplicationsInspector));

    expect(await screen.findByText("Latest result")).toBeTruthy();
    const capabilityName = await screen.findByText("ccusage Daily Report");
    const capabilityRow = capabilityName.parentElement;
    expect(capabilityRow?.className).toContain("grid");
    expect(capabilityRow?.children[1]?.className).toContain("min-w-0");
    expect(capabilityRow?.children[1]?.className).not.toContain("shrink-0");
    expect(await screen.findByText("ready")).toBeTruthy();
    expect(screen.getAllByText("importedUsageEstimates").length).toBeGreaterThan(0);
    expect(screen.getByText("use_1")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /View invocation/i }));

    expect(useUiStore.getState().section).toBe("invocations");
    expect(useUiStore.getState().selectedInvocationId).toBe("inv_app_ccusage");
  });

  it("renders seeded recovery explanation guidance in history and action cards", async () => {
    apiMock.fetchState.mockResolvedValue(recoveryConsoleState());
    apiMock.listApplicationCapabilities.mockResolvedValue({ applicationId: "app_docs", capabilities: [] });
    apiMock.listApplicationOrchestrationRuns.mockResolvedValue({
      applicationId: "app_docs",
      routineId: "app-app_docs-maintenance",
      runs: [{
        invocationId: "inv_failed",
        status: "failed",
        agentId: "agt_demo_cli",
        errorSummary: "Routine validation failed.",
        createdAt: "2026-07-04T02:00:00.000Z",
        updatedAt: "2026-07-04T02:01:00.000Z",
      }],
    });
    apiMock.getApplicationOrchestrationRun.mockResolvedValue({
      applicationId: "app_docs",
      routineId: "app-app_docs-maintenance",
      run: {
        invocationId: "inv_failed",
        status: "failed",
        agentId: "agt_demo_cli",
        errorSummary: "Routine validation failed.",
        createdAt: "2026-07-04T02:00:00.000Z",
        updatedAt: "2026-07-04T02:01:00.000Z",
        metadata: {
          source: "application_orchestration",
          applicationId: "app_docs",
          routineId: "app-app_docs-maintenance",
        },
      },
    });
    apiMock.listApplicationOrchestrationRunEvents.mockResolvedValue({
      applicationId: "app_docs",
      routineId: "app-app_docs-maintenance",
      invocationId: "inv_failed",
      events: [],
    });
    apiMock.getApplicationOrchestrationRunRecovery.mockResolvedValue({
      applicationId: "app_docs",
      routineId: "app-app_docs-maintenance",
      invocationId: "inv_failed",
      recovery: {
        category: "validation_failed",
        confidence: 0.91,
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
          blockedReason: "same_action_approval_pending",
          latestRequestId: "app_rec_pending",
        }, {
          type: "select_agent",
          label: "Select agent",
          description: "Retry on a healthy platform agent.",
          requiresApproval: false,
          recommended: false,
          riskLevel: "medium",
          availability: { state: "available" },
        }],
      },
    });
    apiMock.listApplicationOrchestrationRecoveryAgentCandidates.mockResolvedValue({
      applicationId: "app_docs",
      routineId: "app-app_docs-maintenance",
      invocationId: "inv_failed",
      recoveryCategory: "validation_failed",
      sourceAgentId: "agt_demo_cli",
      preferredAgentId: "agt_platform_application_control",
      candidates: agentCandidates(),
    });

    useUiStore.setState({ selectedApplicationId: "app_docs" });
    renderWithClient(createElement(ApplicationsInspector));

    fireEvent.click(await screen.findByRole("button", { name: /Inspect/i }));

    expect((await screen.findAllByText("Recovery guidance")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Waiting for approval").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Approval pending").length).toBeGreaterThan(0);
    expect(screen.getAllByText("cdx_appr_pending").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Already pending approval").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/app_rec_pending/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Resolve the linked approval request before this recovery can execute.").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText("Recovery action"));

    expect(screen.getAllByText("Executed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Execution completed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("inv_result").length).toBeGreaterThan(0);
    expect(screen.getAllByText("app-app_docs-maintenance").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Inspect the recovery result and continue with the recovered orchestration.").length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(apiMock.getApplicationOrchestrationRunRecovery).toHaveBeenCalledWith(
        "app_docs",
        "app-app_docs-maintenance",
        "inv_failed",
      );
    });
  });

  it("copies a shareable application run deep link from diagnostics", async () => {
    const writeText = mockClipboard();
    window.history.replaceState(null, "", "/console?keep=yes#recovery");
    apiMock.fetchState.mockResolvedValue(recoveryConsoleState());
    apiMock.listApplicationCapabilities.mockResolvedValue({ applicationId: "app_docs", capabilities: [] });
    apiMock.listApplicationOrchestrationRuns.mockResolvedValue({
      applicationId: "app_docs",
      routineId: "app-app_docs-maintenance",
      runs: [{
        invocationId: "inv_failed",
        status: "failed",
        agentId: "agt_demo_cli",
        errorSummary: "Routine validation failed.",
        createdAt: "2026-07-04T02:00:00.000Z",
        updatedAt: "2026-07-04T02:01:00.000Z",
      }],
    });
    apiMock.getApplicationOrchestrationRun.mockResolvedValue({
      applicationId: "app_docs",
      routineId: "app-app_docs-maintenance",
      run: {
        invocationId: "inv_failed",
        status: "failed",
        agentId: "agt_demo_cli",
        errorSummary: "Routine validation failed.",
        createdAt: "2026-07-04T02:00:00.000Z",
        updatedAt: "2026-07-04T02:01:00.000Z",
        metadata: {
          source: "application_orchestration",
          applicationId: "app_docs",
          routineId: "app-app_docs-maintenance",
        },
      },
    });
    apiMock.listApplicationOrchestrationRunEvents.mockResolvedValue({
      applicationId: "app_docs",
      routineId: "app-app_docs-maintenance",
      invocationId: "inv_failed",
      events: [],
    });
    apiMock.getApplicationOrchestrationRunRecovery.mockResolvedValue({
      applicationId: "app_docs",
      routineId: "app-app_docs-maintenance",
      invocationId: "inv_failed",
      recovery: {
        category: "validation_failed",
        confidence: 0.91,
        retryRecommended: false,
        humanApprovalRequired: true,
        summary: "The routine failed validation; regenerate the orchestration.",
        actions: [],
      },
    });

    useUiStore.setState({ selectedApplicationId: "app_docs" });
    renderWithClient(createElement(ApplicationsInspector));

    fireEvent.click(await screen.findByRole("button", { name: /Inspect/i }));
    expect(await screen.findByText("Run diagnostics")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Copy run link/i }));

    expect(writeText).toHaveBeenCalledTimes(1);
    const url = new URL(writeText.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/console");
    expect(url.hash).toBe("#recovery");
    expect(url.searchParams.get("keep")).toBe("yes");
    expect(url.searchParams.get("section")).toBe("applications");
    expect(url.searchParams.get("application")).toBe("app_docs");
    expect(url.searchParams.get("routine")).toBe("app-app_docs-maintenance");
    expect(url.searchParams.get("run")).toBe("inv_failed");
    expect(screen.getByText("Copied.")).toBeTruthy();
  });

  it("does not expand a stale selected application run into the wrong diagnostics", async () => {
    apiMock.fetchState.mockResolvedValue(recoveryConsoleState());
    apiMock.listApplicationCapabilities.mockResolvedValue({ applicationId: "app_docs", capabilities: [] });
    apiMock.listApplicationOrchestrationRuns.mockResolvedValue({
      applicationId: "app_docs",
      routineId: "app-app_docs-maintenance",
      runs: [{
        invocationId: "inv_failed",
        status: "failed",
        agentId: "agt_demo_cli",
        errorSummary: "Routine validation failed.",
        createdAt: "2026-07-04T02:00:00.000Z",
        updatedAt: "2026-07-04T02:01:00.000Z",
      }],
    });

    useUiStore.setState({
      selectedApplicationId: "app_docs",
      selectedApplicationRun: {
        applicationId: "app_docs",
        routineId: "app-app_docs-maintenance",
        invocationId: "inv_stale",
      },
    });
    renderWithClient(createElement(ApplicationsInspector));

    expect(await screen.findByText("inv_failed")).toBeTruthy();
    expect(screen.queryByText("Run diagnostics")).toBeNull();
    expect(apiMock.getApplicationOrchestrationRun).not.toHaveBeenCalled();
    expect(apiMock.getApplicationOrchestrationRunRecovery).not.toHaveBeenCalled();
  });
});

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchInterval: false },
      mutations: { retry: false },
    },
  });
  return render(createElement(QueryClientProvider, { client }, ui));
}

function recoveryConsoleState(): ConsoleSnapshot {
  return {
    device: {
      id: "dev_local",
      name: "Local Workstation",
      status: "online",
      platform: "win32",
      architecture: "x64",
      lastSeenAt: "2026-07-04T02:00:00.000Z",
    },
    agent: null,
    agents: [],
    invocations: [{
      id: "inv_failed",
      status: "failed",
      agentId: "agt_demo_cli",
      createdAt: "2026-07-04T02:00:00.000Z",
      options: {
        metadata: {
          source: "application_orchestration",
          applicationId: "app_docs",
          routineId: "app-app_docs-maintenance",
        },
      },
    }],
    events: [],
    auditSummaries: [],
    applications: [{
      id: "app_docs",
      name: "Docs App",
      kind: "repository",
      status: "active",
      source: { type: "local", path: "C:\\apps\\docs" },
      orchestrations: [{
        routineId: "app-app_docs-maintenance",
        status: "draft",
        relativePath: ".myagenttool/applications/app_docs/app-app_docs-maintenance.json",
        validation: { ok: true },
      }],
      orchestrationIds: ["app-app_docs-maintenance"],
      createdAt: "2026-07-04T01:00:00.000Z",
      updatedAt: "2026-07-04T01:30:00.000Z",
    }],
    applicationRecoveryActions: [{
      id: "app_rec_pending",
      applicationId: "app_docs",
      routineId: "app-app_docs-maintenance",
      invocationId: "inv_failed",
      actionType: "regenerate_orchestration",
      status: "approval_pending",
      recoveryCategory: "validation_failed",
      reason: "Routine validation failed.",
      requiresApproval: true,
      approvalRequestId: "cdx_appr_pending",
      outcomeReason: "approval_pending",
      outcome: {
        state: "pending",
        reason: "approval_pending",
        severity: "info",
        summary: "Recovery is still pending or executing.",
        nextStep: "Resolve the linked approval request before this recovery can execute.",
      },
      explanation: {
        selectedAction: "regenerate_orchestration",
        state: "approval_pending",
        reason: "approval_pending",
        summary: "Recovery action regenerate_orchestration is waiting for approval.",
        nextStep: "Resolve the linked approval request before this recovery can execute.",
        recoveryCategory: "validation_failed",
        recoveryActionRequestId: "app_rec_pending",
        approvalRequestId: "cdx_appr_pending",
      },
      sourceInvocation: { id: "inv_failed", status: "failed", agentId: "agt_demo_cli" },
      resultInvocation: null,
      timeline: [{
        id: "evt_pending",
        type: "application_orchestration_recovery_action_requested",
        status: "approval_pending",
        level: "warn",
        message: "Application orchestration recovery action regenerate_orchestration is pending approval.",
        createdAt: "2026-07-04T02:05:00.000Z",
      }],
      resultInvocationId: null,
      selectedAgentId: null,
      requestedAgentId: null,
      agentCandidateSnapshot: null,
      resultOrchestrationId: null,
      resultOrchestrationRelativePath: null,
      error: null,
      requestedBy: "usr_local",
      decidedAt: null,
      executedAt: null,
      createdAt: "2026-07-04T02:05:00.000Z",
      updatedAt: "2026-07-04T02:06:00.000Z",
    }, {
      id: "app_rec_executed",
      applicationId: "app_docs",
      routineId: "app-app_docs-maintenance",
      invocationId: "inv_failed",
      actionType: "select_agent",
      status: "executed",
      recoveryCategory: "agent_unavailable",
      reason: "Retry on a healthy platform agent.",
      requiresApproval: false,
      approvalRequestId: null,
      resultInvocationId: "inv_result",
      selectedAgentId: "agt_platform_application_control",
      requestedAgentId: "agt_platform_application_control",
      agentCandidateSnapshot: agentCandidates(),
      resultOrchestrationId: "app-app_docs-maintenance",
      resultOrchestrationRelativePath: ".myagenttool/applications/app_docs/app-app_docs-maintenance.json",
      outcomeReason: "result_succeeded",
      outcome: {
        state: "recovered",
        reason: "result_succeeded",
        severity: "success",
        summary: "Recovered invocation completed successfully.",
        nextStep: "No immediate action is required.",
      },
      explanation: {
        selectedAction: "select_agent",
        state: "executed",
        reason: "execution_completed",
        summary: "Recovery action select_agent executed successfully.",
        nextStep: "Inspect the recovery result and continue with the recovered orchestration.",
        recoveryActionRequestId: "app_rec_executed",
        selectedAgentId: "agt_platform_application_control",
        requestedAgentId: "agt_platform_application_control",
        resultInvocationId: "inv_result",
        resultOrchestrationId: "app-app_docs-maintenance",
        resultOrchestrationRelativePath: ".myagenttool/applications/app_docs/app-app_docs-maintenance.json",
      },
      sourceInvocation: { id: "inv_failed", status: "failed", agentId: "agt_demo_cli" },
      resultInvocation: { id: "inv_result", status: "succeeded", agentId: "agt_platform_application_control" },
      timeline: [{
        id: "evt_executed",
        type: "application_orchestration_recovery_action_executed",
        status: "executed",
        level: "info",
        message: "Application orchestration recovery action select_agent executed.",
        createdAt: "2026-07-04T02:03:00.000Z",
      }],
      error: null,
      requestedBy: "usr_local",
      decidedAt: null,
      executedAt: "2026-07-04T02:03:00.000Z",
      createdAt: "2026-07-04T02:02:00.000Z",
      updatedAt: "2026-07-04T02:03:00.000Z",
    }],
  };
}

function closedLoopConsoleState(): ConsoleSnapshot {
  return {
    device: {
      id: "dev_local",
      name: "Local Workstation",
      status: "online",
      platform: "win32",
      architecture: "x64",
      lastSeenAt: "2026-07-04T03:00:00.000Z",
    },
    agent: null,
    agents: [],
    invocations: [{
      id: "inv_app_ccusage",
      status: "succeeded",
      agentId: "agt_platform_application_wrapper",
      createdAt: "2026-07-04T03:00:00.000Z",
      options: {
        metadata: {
          providerType: "application",
          applicationId: "app_ccusage",
          capability: "app.app_ccusage.wrapper.daily",
        },
      },
    }],
    events: [],
    auditSummaries: [],
    applications: [{
      id: "app_ccusage",
      name: "ccusage",
      kind: "npm",
      status: "active",
      source: { type: "npm", package: "ccusage", version: "20.0.14" },
      latestResult: {
        applicationId: "app_ccusage",
        capability: "app.app_ccusage.wrapper.daily",
        outputCollection: "importedUsageEstimates",
        importedRecordIds: ["use_1"],
        importedRecordCount: 1,
        invocationId: "inv_app_ccusage",
        status: "succeeded",
        completedAt: "2026-07-04T03:05:00.000Z",
      },
      createdAt: "2026-07-04T02:00:00.000Z",
      updatedAt: "2026-07-04T03:05:00.000Z",
    }],
    applicationRecoveryActions: [],
  };
}

function agentCandidates(): ApplicationOrchestrationRecoveryAgentCandidate[] {
  return [{
    id: "agt_platform_application_control",
    name: "Application Control",
    status: "active",
    healthStatus: "healthy",
    locationType: "server",
    adapterType: "application_control",
    selectable: true,
    reasons: [],
    preferred: true,
    sourceAgent: false,
  }];
}

function invocation(id: string, applicationId: string, routineId: string): InvocationSnapshot {
  return {
    id,
    status: "queued",
    options: {
      metadata: {
        source: "application_orchestration",
        applicationId,
        routineId,
      },
    },
  };
}
