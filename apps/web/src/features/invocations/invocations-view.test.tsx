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
  searchTraces: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  fetchState: apiMock.fetchState,
  api: {
    getApplicationOrchestrationRunRecovery: apiMock.getApplicationOrchestrationRunRecovery,
    searchTraces: apiMock.searchTraces,
  },
}));
vi.mock("@/features/invocations/trace-api", () => ({
  searchTraces: apiMock.searchTraces,
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

function mockClipboard() {
  const writeText = vi.fn();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

describe("InvocationsView operator explanation", () => {
  it("shows server Trace matches with bounded relation evidence", async () => {
    apiMock.fetchState.mockResolvedValue({ invocations: [], events: [], evidenceLedger: [] });
    apiMock.searchTraces.mockResolvedValue({
      total: 1,
      nextCursor: null,
      records: [{
        invocationId: "inv_trace",
        task: "Prepare review deck",
        agentId: "agt_docs",
        projectId: "p1",
        worktreeId: "",
        traceId: "trace_1",
        status: "succeeded",
        eventTypes: ["application.completed"],
        eventIds: ["evt_1"],
        evidenceIds: ["ev_1"],
        applicationIds: ["app_powerpoint"],
        channelIds: ["channel_ops"],
        createdAt: "2026-07-25T00:00:00Z",
      }],
    });
    useUiStore.setState({ section: "invocations" });
    renderWithClient(createElement(NavigationSyncedInvocationsView));
    fireEvent.change(await screen.findByRole("searchbox", { name: "Search Trace" }), { target: { value: "deck" } });
    expect(await screen.findByText("Prepare review deck")).toBeTruthy();
    expect(screen.getByText("Application · app_powerpoint")).toBeTruthy();
    expect(screen.getByText("Channel · channel_ops")).toBeTruthy();
    expect(screen.getByText("Event · application.completed")).toBeTruthy();
    expect(screen.queryByText("Evidence · ev_1")).toBeNull();
  });
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
    const writeText = mockClipboard();
    window.history.replaceState(null, "", "/console?keep=yes#operator");
    apiMock.fetchState.mockResolvedValue(actionExplanationState());

    useUiStore.setState({ section: "invocations", selectedInvocationId: "inv_report" });
    renderWithClient(createElement(NavigationSyncedInvocationsView));

    expect(await screen.findByText("Troubleshooting report is ready.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Open report/i }));
    expect(useUiStore.getState().section).toBe("invocations");
    expect(useUiStore.getState().selectedInvocationId).toBe("inv_failed");

    useUiStore.setState({ section: "invocations", selectedInvocationId: "inv_report" });
    await waitFor(() => expect(screen.getByText("Troubleshooting report is ready.")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /View source/i }));
    expect(useUiStore.getState().section).toBe("invocations");
    expect(useUiStore.getState().selectedInvocationId).toBe("inv_failed");

    useUiStore.setState({ section: "invocations", selectedInvocationId: "inv_report" });
    await waitFor(() => expect(screen.getByText("Troubleshooting report links")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /^Open failed invocation$/i }));
    expect(useUiStore.getState().section).toBe("invocations");
    expect(useUiStore.getState().selectedInvocationId).toBe("inv_failed");

    useUiStore.setState({ section: "invocations", selectedInvocationId: "inv_report" });
    await waitFor(() => expect(screen.getByText("Troubleshooting report links")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /^Open troubleshooter invocation$/i }));
    expect(useUiStore.getState().section).toBe("invocations");
    expect(useUiStore.getState().selectedInvocationId).toBe("inv_report");

    fireEvent.click(screen.getByRole("button", { name: /^Open application run$/i }));
    expect(useUiStore.getState().section).toBe("applications");
    expect(useUiStore.getState().selectedApplicationId).toBe("app_docs");
    expect(useUiStore.getState().selectedApplicationRun).toEqual({
      applicationId: "app_docs",
      routineId: "routine_docs_smoke",
      invocationId: "inv_failed",
    });

    useUiStore.setState({ section: "invocations", selectedInvocationId: "inv_report" });
    await waitFor(() => expect(screen.getByText("Troubleshooting report links")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /^Copy Open application run$/i }));
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = new URL(writeText.mock.calls[0][0] as string);
    expect(copied.pathname).toBe("/console");
    expect(copied.hash).toBe("#operator");
    expect(copied.searchParams.get("keep")).toBe("yes");
    expect(copied.searchParams.get("section")).toBe("applications");
    expect(copied.searchParams.get("application")).toBe("app_docs");
    expect(copied.searchParams.get("routine")).toBe("routine_docs_smoke");
    expect(copied.searchParams.get("run")).toBe("inv_failed");
  });

  it("copies a shareable invocation deep link from the operator explanation", async () => {
    const writeText = mockClipboard();
    window.history.replaceState(null, "", "/console?keep=yes#operator");
    apiMock.fetchState.mockResolvedValue(actionExplanationState());

    useUiStore.setState({ section: "invocations", selectedInvocationId: "inv_action" });
    renderWithClient(createElement(InvocationsView));

    expect(await screen.findByText("Actionable explanation")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Copy invocation link/i }));

    expect(writeText).toHaveBeenCalledTimes(1);
    const url = new URL(writeText.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/console");
    expect(url.hash).toBe("#operator");
    expect(url.searchParams.get("keep")).toBe("yes");
    expect(url.searchParams.get("section")).toBe("invocations");
    expect(url.searchParams.get("invocation")).toBe("inv_action");
    expect(screen.getByText("Copied.")).toBeTruthy();
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

  it("shows the rows THIS run imported inline, scoped to the run, with an Economics link", async () => {
    const estimate = (over: Record<string, unknown>) => ({
      id: "ccu_x",
      source: "ccusage",
      reportInvocationId: "inv_report",
      invocationId: "inv_report",
      reportId: "daily",
      rowIndex: 0,
      amountSource: "imported_ccusage_report" as const,
      economicModel: "external_billed" as const,
      authoritative: false as const,
      createdAt: "2026-07-05T08:00:00.000Z",
      ...over,
    });
    apiMock.fetchState.mockResolvedValue({
      ...actionExplanationState(),
      importedUsageEstimates: [
        estimate({ id: "ccu_1", provider: "claude", model: "claude-sonnet-5", date: "2026-07-10", totalTokens: 12345, estimatedCostUsd: 1.23 }),
        // Another run's row — must NOT leak into this run's card.
        estimate({ id: "ccu_other", invocationId: "inv_other", reportInvocationId: "inv_other", provider: "openai", model: "gpt-other" }),
      ],
    });
    useUiStore.setState({ section: "invocations", selectedInvocationId: "inv_report" });
    renderWithClient(createElement(InvocationsView));

    expect(await screen.findByText("Imported usage · this run")).toBeTruthy();
    expect(screen.getByText("claude-sonnet-5")).toBeTruthy();
    expect(screen.getByText("2026-07-10")).toBeTruthy();
    expect(screen.queryByText("gpt-other")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /View in Economics/i }));
    expect(useUiStore.getState().section).toBe("economics");
  });

  it("hides the imported-usage card for runs that imported nothing", async () => {
    apiMock.fetchState.mockResolvedValue(actionExplanationState());
    useUiStore.setState({ section: "invocations", selectedInvocationId: "inv_report" });
    renderWithClient(createElement(InvocationsView));
    await screen.findByText(/Timeline · inv_report/);
    expect(screen.queryByText("Imported usage · this run")).toBeNull();
  });

  it("shows this run's per-round telemetry, scoped to the run", async () => {
    apiMock.fetchState.mockResolvedValue({
      ...actionExplanationState(),
      invocationRounds: [
        {
          id: "rnd_1", invocationId: "inv_report", roundIndex: 0, provider: "anthropic",
          model: "claude-opus-4-8", status: "succeeded", inputTokens: 100, outputTokens: 50,
          cachedTokens: 25, reasoningTokens: 0, durationMs: 5000, filesRead: ["/wt/a.mjs"], toolCallIds: ["tiv_1"],
          estimatedCostUsd: 0.1875,
        },
        {
          id: "rnd_2", invocationId: "inv_report", roundIndex: 1, provider: "anthropic",
          model: "claude-opus-4-8", status: "succeeded", inputTokens: 20, outputTokens: 8,
          cachedTokens: 0, reasoningTokens: 0, durationMs: 1200, filesRead: [], toolCallIds: [],
          estimatedCostUsd: 0.02,
        },
        // Another run's round — must NOT leak into this run's card.
        { id: "rnd_other", invocationId: "inv_other", roundIndex: 0, model: "gpt-other-model", status: "succeeded", inputTokens: 1, outputTokens: 1 },
      ],
    });
    useUiStore.setState({ section: "invocations", selectedInvocationId: "inv_report" });
    renderWithClient(createElement(InvocationsView));

    expect(await screen.findByText("Rounds · this run")).toBeTruthy();
    expect(screen.getAllByText("claude-opus-4-8").length).toBe(2);
    expect(screen.getByText("100")).toBeTruthy();
    expect(screen.queryByText("gpt-other-model")).toBeNull();
    // Per-round cost column + run-total estimate.
    expect(screen.getByText("$0.1875")).toBeTruthy();
    expect(screen.getByText(/~\$0\.2075 est\./)).toBeTruthy();
  });

  it("renders an em dash for a round with no priced cost", async () => {
    apiMock.fetchState.mockResolvedValue({
      ...actionExplanationState(),
      invocationRounds: [
        { id: "rnd_np", invocationId: "inv_report", roundIndex: 0, model: "mystery-model", status: "succeeded", inputTokens: 10, outputTokens: 5, estimatedCostUsd: null },
      ],
    });
    useUiStore.setState({ section: "invocations", selectedInvocationId: "inv_report" });
    renderWithClient(createElement(InvocationsView));
    await screen.findByText("Rounds · this run");
    // No run-total estimate when nothing is priced; the cost cell shows an em dash.
    expect(screen.queryByText(/est\./)).toBeNull();
  });

  it("hides the rounds card for runs with no round telemetry", async () => {
    apiMock.fetchState.mockResolvedValue(actionExplanationState());
    useUiStore.setState({ section: "invocations", selectedInvocationId: "inv_report" });
    renderWithClient(createElement(InvocationsView));
    await screen.findByText(/Timeline · inv_report/);
    expect(screen.queryByText("Rounds · this run")).toBeNull();
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
      troubleshooterInvocationId: "inv_report",
      summary: "Troubleshooter reviewed inv_failed.",
      bridgeState: "online",
      logSummary: "No logs.",
      webLinks: {
        failedInvocation: {
          label: "Open failed invocation",
          query: "?section=invocations&invocation=inv_failed",
          target: {
            section: "invocations",
            invocation: "inv_failed",
          },
        },
        troubleshooterInvocation: {
          label: "Open troubleshooter invocation",
          query: "?section=invocations&invocation=inv_report",
          target: {
            section: "invocations",
            invocation: "inv_report",
          },
        },
        applicationRun: {
          label: "Open application run",
          query: "?section=applications&application=app_docs&routine=routine_docs_smoke&run=inv_failed",
          target: {
            section: "applications",
            application: "app_docs",
            routine: "routine_docs_smoke",
            run: "inv_failed",
          },
        },
      },
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
