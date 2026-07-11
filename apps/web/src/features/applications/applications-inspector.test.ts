import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  createToolInvocation: vi.fn(),
  createCapabilityInvocation: vi.fn(),
  grantApplicationWrapperPolicyConsent: vi.fn(),
  revokeApplicationWrapperPolicyConsent: vi.fn(),
  listApplicationEvents: vi.fn(),
  listApplicationOrchestrationRuns: vi.fn(),
  getApplicationOrchestrationRun: vi.fn(),
  listApplicationOrchestrationRunEvents: vi.fn(),
  getApplicationOrchestrationRunRecovery: vi.fn(),
  listApplicationOrchestrationRecoveryAgentCandidates: vi.fn(),
  requestApplicationOrchestrationRecoveryAction: vi.fn(),
  confirmApplicationMcpCandidate: vi.fn(),
  probeApplicationMcpCandidate: vi.fn(),
  applicationLifecycle: vi.fn(),
  applicationWebEditor: vi.fn(),
  importApplicationEditorResult: vi.fn(),
  getApplicationResult: vi.fn(),
  listApplicationResults: vi.fn(),
  getLatestApplicationResult: vi.fn(),
  updateApplicationResult: vi.fn(),
  updateApplicationResultRetention: vi.fn(),
  runApplicationResultRetention: vi.fn(),
  saveImportedEvidence: vi.fn(),
  saveApplicationSmokeEvidence: vi.fn(),
  approveApproval: vi.fn(),
  createAutomation: vi.fn(),
  runAutomation: vi.fn(),
  updateAutomation: vi.fn(),
  deleteAutomation: vi.fn(),
  getApplicationDescriptors: vi.fn(),
  updateApplicationDescriptors: vi.fn(),
}));

vi.mock("@/lib/api-client", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client")),
  fetchState: apiMock.fetchState,
  api: {
    listApplicationCapabilities: apiMock.listApplicationCapabilities,
    createToolInvocation: apiMock.createToolInvocation,
    createCapabilityInvocation: apiMock.createCapabilityInvocation,
    grantApplicationWrapperPolicyConsent: apiMock.grantApplicationWrapperPolicyConsent,
    revokeApplicationWrapperPolicyConsent: apiMock.revokeApplicationWrapperPolicyConsent,
    listApplicationEvents: apiMock.listApplicationEvents,
    listApplicationOrchestrationRuns: apiMock.listApplicationOrchestrationRuns,
    getApplicationOrchestrationRun: apiMock.getApplicationOrchestrationRun,
    listApplicationOrchestrationRunEvents: apiMock.listApplicationOrchestrationRunEvents,
    getApplicationOrchestrationRunRecovery: apiMock.getApplicationOrchestrationRunRecovery,
    listApplicationOrchestrationRecoveryAgentCandidates: apiMock.listApplicationOrchestrationRecoveryAgentCandidates,
    requestApplicationOrchestrationRecoveryAction: apiMock.requestApplicationOrchestrationRecoveryAction,
    confirmApplicationMcpCandidate: apiMock.confirmApplicationMcpCandidate,
    probeApplicationMcpCandidate: apiMock.probeApplicationMcpCandidate,
    applicationLifecycle: apiMock.applicationLifecycle,
    applicationWebEditor: apiMock.applicationWebEditor,
    importApplicationEditorResult: apiMock.importApplicationEditorResult,
    getApplicationResult: apiMock.getApplicationResult,
    listApplicationResults: apiMock.listApplicationResults,
    getLatestApplicationResult: apiMock.getLatestApplicationResult,
    updateApplicationResult: apiMock.updateApplicationResult,
    updateApplicationResultRetention: apiMock.updateApplicationResultRetention,
    runApplicationResultRetention: apiMock.runApplicationResultRetention,
    saveImportedEvidence: apiMock.saveImportedEvidence,
    saveApplicationSmokeEvidence: apiMock.saveApplicationSmokeEvidence,
    approveApproval: apiMock.approveApproval,
    createAutomation: apiMock.createAutomation,
    runAutomation: apiMock.runAutomation,
    updateAutomation: apiMock.updateAutomation,
    deleteAutomation: apiMock.deleteAutomation,
    getApplicationDescriptors: apiMock.getApplicationDescriptors,
    updateApplicationDescriptors: apiMock.updateApplicationDescriptors,
  },
}));

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  apiMock.listApplicationEvents.mockResolvedValue({ applicationId: "app", events: [] });
  apiMock.createToolInvocation.mockResolvedValue({ invocationId: "inv_ccusage_daily", status: "queued" });
  apiMock.createCapabilityInvocation.mockResolvedValue({ invocationId: "inv_wrapper_run", status: "queued" });
  apiMock.grantApplicationWrapperPolicyConsent.mockResolvedValue({ consent: { state: "granted" } });
  apiMock.revokeApplicationWrapperPolicyConsent.mockResolvedValue({ consent: { state: "revoked" } });
  apiMock.applicationLifecycle.mockResolvedValue({ application: { id: "app_ccusage" } });
  apiMock.applicationWebEditor.mockResolvedValue({ application: { id: "app_doocs_md" }, editor: { status: "starting" } });
  apiMock.importApplicationEditorResult.mockResolvedValue({
    application: { id: "app_doocs_md" },
    result: {
      id: "app_render_editor",
      applicationId: "app_doocs_md",
      artifactType: "html",
      evidenceType: "editor_rendered_markdown",
      theme: "default",
      htmlSummary: "Editor handoff",
      resultRef: { type: "application_render_result", id: "app_render_editor", href: "/api/applications/app_doocs_md/results/app_render_editor" },
    },
    latestResult: {
      applicationId: "app_doocs_md",
      resultRef: { type: "application_render_result", id: "app_render_editor", href: "/api/applications/app_doocs_md/results/app_render_editor" },
      importedRecordIds: ["app_render_editor"],
      importedRecordCount: 1,
      status: "succeeded",
    },
  });
  apiMock.getApplicationResult.mockResolvedValue({
    applicationId: "app_doocs_md",
    result: {
      id: "app_render_1",
      applicationId: "app_doocs_md",
      invocationId: "inv_doocs_render",
      theme: "github",
      markdownHash: "a".repeat(64),
      htmlHash: "b".repeat(64),
      htmlByteLength: 28,
      htmlSummary: "Hello from doocs.",
      html: "<h1>Hello from doocs.</h1>",
      metadata: {
        source: "application_web_editor",
        postTitle: "Hello from doocs",
        editorUrl: "http://localhost:5173/md/?myagenttoolApplicationId=app_doocs_md",
        theme: "github",
        markdownLength: 18,
        htmlByteLength: 28,
      },
      resultRef: { type: "application_render_result", id: "app_render_1" },
    },
  });
  apiMock.listApplicationResults.mockResolvedValue({ applicationId: "app", results: [], count: 0 });
  apiMock.getLatestApplicationResult.mockResolvedValue({
    applicationId: "app_doocs_md",
    result: {
      id: "app_render_1",
      applicationId: "app_doocs_md",
      invocationId: "inv_doocs_render",
      theme: "github",
      markdownHash: "a".repeat(64),
      htmlHash: "b".repeat(64),
      htmlByteLength: 28,
      htmlSummary: "Hello from doocs.",
      html: "<h1>Hello from doocs.</h1>",
      metadata: {
        source: "application_web_editor",
        postTitle: "Hello from doocs",
        editorUrl: "http://localhost:5173/md/?myagenttoolApplicationId=app_doocs_md",
        theme: "github",
        markdownLength: 18,
        htmlByteLength: 28,
      },
      resultRef: { type: "application_render_result", id: "app_render_1" },
    },
  });
  apiMock.updateApplicationResult.mockResolvedValue({
    applicationId: "app_doocs_md",
    result: {
      id: "app_render_1",
      applicationId: "app_doocs_md",
      governance: { pinned: true, archived: false, retentionPolicy: "standard" },
    },
  });
  apiMock.updateApplicationResultRetention.mockResolvedValue({
    application: { id: "app_doocs_md" },
    retention: { enabled: true, keepLatest: 5, archiveAfterDays: null },
  });
  apiMock.runApplicationResultRetention.mockResolvedValue({
    application: { id: "app_doocs_md" },
    retention: { enabled: true, keepLatest: 5, archiveAfterDays: null, lastArchivedCount: 1 },
    summary: { applicationId: "app_doocs_md", archivedCount: 1, archivedResultIds: ["app_render_old"] },
  });
  apiMock.saveImportedEvidence.mockResolvedValue({
    importedEvidence: { id: "codex_evidence_1", source: "application_smoke_evidence" },
  });
  apiMock.saveApplicationSmokeEvidence.mockResolvedValue({
    evidence: { id: "app_smoke_1", source: "application_smoke_evidence" },
  });
  apiMock.probeApplicationMcpCandidate.mockResolvedValue({ liveProbe: { state: "succeeded" } });
  apiMock.createAutomation.mockResolvedValue({ automation: { id: "atm_app_daily", nextRunAt: "2026-07-05T09:00:00.000Z" } });
  apiMock.runAutomation.mockResolvedValue({ invocationId: "inv_auto_run", status: "queued" });
  apiMock.updateAutomation.mockResolvedValue({ automation: { id: "atm_app_daily" } });
  apiMock.deleteAutomation.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  apiMock.listApplicationEvents.mockReset();
  window.history.replaceState(null, "", "/");
  useUiStore.setState({
    section: "dashboard",
    selectedApplicationId: null,
    selectedInvocationId: null,
    selectedApplicationRun: null,
    selectedApplicationResultId: null,
    selectedApplicationRecoveryId: null,
    selectedApplicationEventLevel: "all",
    selectedApplicationAutomationId: null,
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
    apiMock.listApplicationEvents.mockResolvedValue({
      applicationId: "app_ccusage",
      events: [{
        id: "evt_app_probe",
        invocationId: null,
        type: "application_probed",
        level: "info",
        message: "ccusage application probe completed.",
        data: { applicationId: "app_ccusage", capabilityCount: 2, mcpServerCandidateCount: 0 },
        createdAt: "2026-07-04T03:01:00.000Z",
      }],
    });

    useUiStore.setState({ selectedApplicationId: "app_ccusage" });
    renderWithClient(createElement(ApplicationsInspector));

    expect(await screen.findByText("Latest result")).toBeTruthy();
    expect((await screen.findAllByText("ccusage Daily Report")).length).toBeGreaterThan(0);
    expect(await screen.findByText("Application timeline")).toBeTruthy();
    expect(await screen.findByText("application_probed")).toBeTruthy();
    expect(await screen.findByText(/2 capabilities/)).toBeTruthy();
    expect(await screen.findByText("ready")).toBeTruthy();
    expect(screen.getAllByText("importedUsageEstimates").length).toBeGreaterThan(0);
    expect(screen.getByText("use_1")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /View invocation/i }));

    expect(useUiStore.getState().section).toBe("invocations");
    expect(useUiStore.getState().selectedInvocationId).toBe("inv_app_ccusage");
  });

  it("keeps long capability names readable beside status badges", async () => {
    apiMock.fetchState.mockResolvedValue(closedLoopConsoleState());
    apiMock.listApplicationCapabilities.mockResolvedValue({
      applicationId: "app_ccusage",
      capabilities: [{
        name: "app.app_ccusage.inspect",
        kind: "read",
        riskLevel: "low",
        status: "available",
        requiresApproval: false,
        metadata: {
          readiness: { state: "ready" },
          resultPath: { outputCollection: "importedUsageEstimates" },
        },
      }],
    });

    useUiStore.setState({ selectedApplicationId: "app_ccusage" });
    renderWithClient(createElement(ApplicationsInspector));

    await screen.findByText("Capabilities");
    const row = await waitFor(() => {
      const capabilityPanel = screen.getByText("Capabilities");
      const card = capabilityPanel.closest("[data-application-panel='capabilities']");
      expect(card).toBeTruthy();
      const capabilityRow = card!.querySelector("[data-capability-row]");
      expect(capabilityRow).toBeTruthy();
      return capabilityRow as HTMLElement;
    });
    expect(within(row as HTMLElement).getByText("inspect")).toBeTruthy();
    expect(within(row as HTMLElement).getByText("app.app_ccusage.inspect")).toBeTruthy();
    expect(row.querySelector(".justify-between")).toBeNull();
  });

  it("surfaces timeline and probe actions in the operator action panel", async () => {
    const state = closedLoopConsoleState();
    state.applications![0].probe = null;
    state.applications![0].orchestrationIds = ["routine_ccusage"];
    state.applications![0].healthSummary = {
      applicationId: "app_ccusage",
      eventCounts: { error: 1, warning: 0, info: 0, other: 0 },
      eventCount: 1,
      latestAttentionEvent: {
        id: "evt_probe_failed",
        type: "application_probe_failed",
        level: "error",
        message: "Probe command failed.",
        data: {},
        createdAt: "2026-07-04T03:08:00.000Z",
      },
    };
    apiMock.fetchState.mockResolvedValue(state);
    apiMock.listApplicationCapabilities.mockResolvedValue({ applicationId: "app_ccusage", capabilities: [] });
    apiMock.listApplicationEvents.mockResolvedValue({
      applicationId: "app_ccusage",
      events: [state.applications![0].healthSummary.latestAttentionEvent!],
    });

    useUiStore.setState({ selectedApplicationId: "app_ccusage" });
    renderWithClient(createElement(ApplicationsInspector));

    expect(await screen.findByText("Action required")).toBeTruthy();
    expect(screen.getByText("Timeline error")).toBeTruthy();
    expect(screen.getByText("Probe recommended")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /View errors/i }));
    expect(useUiStore.getState().selectedApplicationEventLevel).toBe("error");
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Run probe/i }));
    await waitFor(() => expect(apiMock.applicationLifecycle).toHaveBeenCalledWith("app_ccusage", "probe"));
  });

  it("opens automation failures and recovery actions from the operator action panel", async () => {
    const state = closedLoopConsoleState();
    state.applications![0].probe = { capabilities: [] };
    state.applications![0].orchestrationIds = ["routine_ccusage"];
    state.applications![0].healthSummary = {
      applicationId: "app_ccusage",
      eventCounts: { error: 0, warning: 0, info: 0, other: 0 },
      eventCount: 0,
      automationCounts: { failing: 1, waitingForApproval: 0, paused: 0, attention: 1 },
      latestAutomationAttention: {
        automationId: "atm_ccusage_daily",
        name: "ccusage daily",
        status: "failing",
        latestInvocationId: "inv_auto_failed",
        lastErrorSummary: "Wrapper command exited 1.",
      },
    };
    state.applicationRecoveryActions = [{
      id: "rec_ccusage_pending",
      applicationId: "app_ccusage",
      routineId: "routine_ccusage",
      invocationId: "inv_auto_failed",
      actionType: "rerun",
      status: "approval_pending",
      reason: "Retry the failed scheduled run.",
      requiresApproval: true,
      approvalRequestId: "apr_rec",
      explanation: {
        state: "approval_pending",
        nextStep: "Resolve the linked approval request before this recovery can execute.",
      },
      createdAt: "2026-07-04T03:09:00.000Z",
      updatedAt: "2026-07-04T03:10:00.000Z",
    }];
    apiMock.fetchState.mockResolvedValue(state);
    apiMock.listApplicationCapabilities.mockResolvedValue({ applicationId: "app_ccusage", capabilities: [] });

    useUiStore.setState({ selectedApplicationId: "app_ccusage" });
    renderWithClient(createElement(ApplicationsInspector));

    expect(await screen.findByText("Recovery action open")).toBeTruthy();
    expect(screen.getByText("Schedule failing")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /View recovery/i }));
    expect(useUiStore.getState().selectedApplicationRun).toEqual({
      applicationId: "app_ccusage",
      routineId: "routine_ccusage",
      invocationId: "inv_auto_failed",
    });

    fireEvent.click(screen.getByRole("button", { name: /Open failing run/i }));
    expect(useUiStore.getState().section).toBe("invocations");
    expect(useUiStore.getState().selectedInvocationId).toBe("inv_auto_failed");
  });

  it("renders probe diff groups in the probe card", async () => {
    const state = closedLoopConsoleState();
    state.applications![0].probe = {
      status: "completed",
      checkedAt: "2026-07-04T03:05:00.000Z",
      summary: "NPM package ccusage@20.0.16 probed.",
      capabilities: [],
      diff: {
        previousCheckedAt: "2026-07-04T03:00:00.000Z",
        addedCapabilityNames: ["app.app_ccusage.wrapper.daily"],
        removedCapabilityNames: ["app.app_ccusage.wrapper.weekly"],
        changedMcpServerIds: ["mcp.ccusage"],
      },
    };
    state.applications![0].wrapper = {
      mode: "installed-wrapper",
      installState: "installed",
      readiness: {
        state: "needs_setup",
        reason: "wrapper_command_unresolved",
        checkedAt: "2026-07-04T03:05:00.000Z",
        readyCommandIds: ["daily"],
        blockedCommandIds: ["weekly"],
      },
      commands: [],
    };
    apiMock.fetchState.mockResolvedValue(state);
    apiMock.listApplicationCapabilities.mockResolvedValue({
      applicationId: "app_ccusage",
      capabilities: [],
    });

    useUiStore.setState({ selectedApplicationId: "app_ccusage" });
    renderWithClient(createElement(ApplicationsInspector));

    expect(await screen.findByText("Added capabilities")).toBeTruthy();
    expect(screen.getByText("Removed capabilities")).toBeTruthy();
    expect(screen.getByText("Changed MCP candidates")).toBeTruthy();
    expect(screen.getAllByText("wrapper.daily").length).toBeGreaterThan(0);
    expect(screen.getAllByText("wrapper.weekly").length).toBeGreaterThan(0);
    expect(screen.getByText("mcp.ccusage")).toBeTruthy();
    expect(screen.getByText("wrapper_command_unresolved")).toBeTruthy();
    expect(screen.getByText(/1 ready · 1 blocked/)).toBeTruthy();
  });

  it("runs a wrapper capability with descriptor-declared inputs", async () => {
    apiMock.fetchState.mockResolvedValue(closedLoopConsoleState());
    apiMock.listApplicationCapabilities.mockResolvedValue({
      applicationId: "app_ccusage",
      capabilities: [{
        name: "app.app_ccusage.wrapper.daily",
        displayName: "ccusage Daily Report",
        kind: "npm_wrapper",
        riskLevel: "low",
        status: "available",
        requiresApproval: false,
        metadata: {
          readiness: { state: "ready", reason: "wrapper_installed", executionMode: "bridge_wrapper" },
          wrapper: {
            commandId: "daily",
            argInputs: [
              { key: "since", flag: "--since", type: "date" },
              { key: "source", flag: "--source", type: "enum", values: ["all", "codex"] },
              { key: "offline", flag: "--offline", type: "boolean-flag" },
            ],
          },
        },
      }],
    });

    useUiStore.setState({ selectedApplicationId: "app_ccusage" });
    renderWithClient(createElement(ApplicationsInspector));

    fireEvent.change(await screen.findByLabelText("since", {}, { timeout: 10_000 }), { target: { value: "2026-07-01" } });
    fireEvent.change(screen.getByLabelText("source"), { target: { value: "codex" } });
    fireEvent.click(screen.getByLabelText("--offline"));
    fireEvent.click(screen.getByRole("button", { name: /^Run$/i }));

    await waitFor(() => expect(apiMock.createCapabilityInvocation).toHaveBeenCalledWith(
      "app.app_ccusage.wrapper.daily",
      { since: "2026-07-01", source: "codex", offline: true },
    ));
    expect(useUiStore.getState().section).toBe("invocations");
    expect(useUiStore.getState().selectedInvocationId).toBe("inv_wrapper_run");
  });

  it("creates an application capability automation from a wrapper capability", async () => {
    const state = closedLoopConsoleState();
    state.applications![0].projectId = "prj_myagenttool";
    apiMock.fetchState.mockResolvedValue(state);
    apiMock.listApplicationCapabilities.mockResolvedValue({
      applicationId: "app_ccusage",
      capabilities: [{
        name: "app.app_ccusage.wrapper.daily",
        displayName: "ccusage Daily Report",
        provider: { type: "application", id: "app_ccusage" },
        kind: "npm_wrapper",
        riskLevel: "low",
        status: "available",
        requiresApproval: false,
        metadata: {
          readiness: { state: "ready", reason: "wrapper_installed", executionMode: "bridge_wrapper" },
          wrapper: { commandId: "daily", argInputs: [] },
        },
      }],
    });

    useUiStore.setState({ selectedApplicationId: "app_ccusage" });
    renderWithClient(createElement(ApplicationsInspector));

    fireEvent.click(await screen.findByRole("button", { name: /^Schedule$/i }, { timeout: 10_000 }));

    await waitFor(() => expect(apiMock.createAutomation).toHaveBeenCalledWith({
      kind: "application_capability",
      name: "ccusage · ccusage Daily Report",
      projectId: "prj_myagenttool",
      enabled: true,
      schedule: { kind: "daily", time: "09:00" },
      target: {
        type: "application_capability",
        applicationId: "app_ccusage",
        capabilityName: "app.app_ccusage.wrapper.daily",
        input: {},
      },
    }));
    expect(await screen.findByText(/Scheduled/)).toBeTruthy();
  });

  it("stores descriptor-declared wrapper inputs on an application capability automation", async () => {
    const state = closedLoopConsoleState();
    state.applications![0].projectId = "prj_myagenttool";
    apiMock.fetchState.mockResolvedValue(state);
    apiMock.listApplicationCapabilities.mockResolvedValue({
      applicationId: "app_ccusage",
      capabilities: [{
        name: "app.app_ccusage.wrapper.daily",
        displayName: "ccusage Daily Report",
        provider: { type: "application", id: "app_ccusage" },
        kind: "npm_wrapper",
        riskLevel: "low",
        status: "available",
        requiresApproval: false,
        metadata: {
          readiness: { state: "ready", reason: "wrapper_installed", executionMode: "bridge_wrapper" },
          wrapper: {
            commandId: "daily",
            argInputs: [
              { key: "since", flag: "--since", type: "date" },
              { key: "source", flag: "--source", type: "enum", values: ["all", "codex"] },
              { key: "offline", flag: "--offline", type: "boolean-flag" },
            ],
          },
        },
      }],
    });

    useUiStore.setState({ selectedApplicationId: "app_ccusage" });
    renderWithClient(createElement(ApplicationsInspector));

    fireEvent.change(await screen.findByLabelText("Schedule since", {}, { timeout: 10_000 }), { target: { value: "2026-07-01" } });
    fireEvent.change(screen.getByLabelText("Schedule source"), { target: { value: "codex" } });
    fireEvent.click(screen.getByLabelText("Schedule --offline"));
    fireEvent.click(screen.getByRole("button", { name: /^Schedule$/i }));

    await waitFor(() => expect(apiMock.createAutomation).toHaveBeenCalledWith({
      kind: "application_capability",
      name: "ccusage · ccusage Daily Report",
      projectId: "prj_myagenttool",
      enabled: true,
      schedule: { kind: "daily", time: "09:00" },
      target: {
        type: "application_capability",
        applicationId: "app_ccusage",
        capabilityName: "app.app_ccusage.wrapper.daily",
        input: { since: "2026-07-01", source: "codex", offline: true },
      },
    }));
  });

  it("runs an existing application capability automation from the capability panel", async () => {
    const state = closedLoopConsoleState();
    state.applications![0].projectId = "prj_myagenttool";
    state.automations = [{
      id: "atm_app_daily",
      name: "ccusage · ccusage Daily Report",
      enabled: true,
      kind: "application_capability",
      projectId: "prj_myagenttool",
      schedule: { kind: "daily", time: "09:00", label: "Daily at 09:00" },
      nextRunAt: "2026-07-05T09:00:00.000Z",
      agentId: "agt_platform_application_wrapper",
      prompt: "Run application capability app.app_ccusage.wrapper.daily.",
      lastRunAt: null,
      lastInvocationId: "inv_app_ccusage",
      runCount: 1,
      target: {
        type: "application_capability",
        applicationId: "app_ccusage",
        capabilityName: "app.app_ccusage.wrapper.daily",
        input: {},
      },
    }];
    apiMock.fetchState.mockResolvedValue(state);
    apiMock.listApplicationCapabilities.mockResolvedValue({
      applicationId: "app_ccusage",
      capabilities: [{
        name: "app.app_ccusage.wrapper.daily",
        displayName: "ccusage Daily Report",
        provider: { type: "application", id: "app_ccusage" },
        kind: "npm_wrapper",
        riskLevel: "low",
        status: "available",
        requiresApproval: false,
        metadata: {
          readiness: { state: "ready", reason: "wrapper_installed", executionMode: "bridge_wrapper" },
          wrapper: { commandId: "daily", argInputs: [] },
        },
      }],
    });

    useUiStore.setState({ selectedApplicationId: "app_ccusage" });
    renderWithClient(createElement(ApplicationsInspector));

    expect(await screen.findByText(/Daily at 09:00/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Run automation now" }));

    await waitFor(() => expect(apiMock.runAutomation).toHaveBeenCalledWith("atm_app_daily"));
    expect(useUiStore.getState().section).toBe("invocations");
    expect(useUiStore.getState().selectedInvocationId).toBe("inv_auto_run");
  });

  it("focuses a selected application automation and opens its approval run", async () => {
    const state = closedLoopConsoleState();
    state.applications![0].projectId = "prj_myagenttool";
    state.automations = [{
      id: "atm_app_daily",
      name: "ccusage · ccusage Daily Report",
      enabled: true,
      kind: "application_capability",
      projectId: "prj_myagenttool",
      schedule: { kind: "daily", time: "09:00", label: "Daily at 09:00" },
      nextRunAt: "2026-07-05T09:00:00.000Z",
      agentId: "agt_platform_application_wrapper",
      prompt: "Run application capability app.app_ccusage.wrapper.daily.",
      lastRunAt: "2026-07-05T09:00:00.000Z",
      lastInvocationId: "inv_auto_waiting",
      runCount: 1,
      healthSummary: {
        automationId: "atm_app_daily",
        status: "waiting_for_approval",
        failureStreak: 0,
        runCount: 1,
        latestRun: {
          invocationId: "inv_auto_waiting",
          status: "waiting_for_local_approval",
          scheduled: true,
          createdAt: "2026-07-05T09:00:00.000Z",
        },
        nextAction: "Resolve the linked approval request before the automation can continue.",
      },
      target: {
        type: "application_capability",
        applicationId: "app_ccusage",
        capabilityName: "app.app_ccusage.wrapper.daily",
        input: {},
      },
    }];
    apiMock.fetchState.mockResolvedValue(state);
    apiMock.listApplicationCapabilities.mockResolvedValue({
      applicationId: "app_ccusage",
      capabilities: [{
        name: "app.app_ccusage.wrapper.daily",
        displayName: "ccusage Daily Report",
        provider: { type: "application", id: "app_ccusage" },
        kind: "npm_wrapper",
        riskLevel: "low",
        status: "available",
        requiresApproval: false,
        metadata: {
          readiness: { state: "ready", reason: "wrapper_installed", executionMode: "bridge_wrapper" },
          wrapper: { commandId: "daily", argInputs: [] },
        },
      }],
    });

    useUiStore.setState({
      selectedApplicationId: "app_ccusage",
      selectedApplicationAutomationId: "atm_app_daily",
    });
    renderWithClient(createElement(ApplicationsInspector));

    expect(await screen.findByText("focused")).toBeTruthy();
    expect(screen.getByText("Approval")).toBeTruthy();
    expect(screen.getByText(/Resolve the linked approval request before the automation can continue/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Review approval/i }));

    expect(useUiStore.getState().section).toBe("invocations");
    expect(useUiStore.getState().selectedInvocationId).toBe("inv_auto_waiting");
  });

  it("surfaces consecutive failures for scheduled application capability runs", async () => {
    const state = closedLoopConsoleState();
    state.applications![0].projectId = "prj_myagenttool";
    state.invocations = [
      {
        id: "inv_auto_failed_new",
        status: "failed",
        agentId: "agt_platform_application_wrapper",
        createdAt: "2026-07-05T11:00:00.000Z",
        result: { summary: "Wrapper command exited 1." },
        options: {
          metadata: {
            providerType: "application",
            applicationId: "app_ccusage",
            capability: "app.app_ccusage.wrapper.daily",
            automationId: "atm_app_daily",
            automationName: "ccusage · ccusage Daily Report",
            scheduled: true,
          },
        },
      },
      {
        id: "inv_auto_failed_old",
        status: "failed",
        agentId: "agt_platform_application_wrapper",
        createdAt: "2026-07-05T10:00:00.000Z",
        options: {
          metadata: {
            providerType: "application",
            applicationId: "app_ccusage",
            capability: "app.app_ccusage.wrapper.daily",
            automationId: "atm_app_daily",
            automationName: "ccusage · ccusage Daily Report",
            scheduled: true,
          },
        },
      },
    ];
    state.auditSummaries = [{
      invocationId: "inv_auto_failed_new",
      errorSummary: "Wrapper command exited 1.",
    }];
    state.automations = [{
      id: "atm_app_daily",
      name: "ccusage · ccusage Daily Report",
      enabled: true,
      kind: "application_capability",
      projectId: "prj_myagenttool",
      schedule: { kind: "daily", time: "09:00", label: "Daily at 09:00" },
      nextRunAt: "2026-07-06T09:00:00.000Z",
      agentId: "agt_platform_application_wrapper",
      prompt: "Run application capability app.app_ccusage.wrapper.daily.",
      lastRunAt: "2026-07-05T11:00:00.000Z",
      lastInvocationId: "inv_auto_failed_new",
      runCount: 2,
      target: {
        type: "application_capability",
        applicationId: "app_ccusage",
        capabilityName: "app.app_ccusage.wrapper.daily",
        input: {},
      },
    }];
    apiMock.fetchState.mockResolvedValue(state);
    apiMock.listApplicationCapabilities.mockResolvedValue({
      applicationId: "app_ccusage",
      capabilities: [{
        name: "app.app_ccusage.wrapper.daily",
        displayName: "ccusage Daily Report",
        provider: { type: "application", id: "app_ccusage" },
        kind: "npm_wrapper",
        riskLevel: "low",
        status: "available",
        requiresApproval: false,
        metadata: {
          readiness: { state: "ready", reason: "wrapper_installed", executionMode: "bridge_wrapper" },
          wrapper: { commandId: "daily", argInputs: [] },
        },
      }],
    });

    useUiStore.setState({ selectedApplicationId: "app_ccusage" });
    renderWithClient(createElement(ApplicationsInspector));

    expect(await screen.findByText("2 consecutive failures")).toBeTruthy();
    expect(screen.getAllByText("Wrapper command exited 1.").length).toBeGreaterThan(0);
    expect(screen.getByText(/Pause the schedule/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /View latest run/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /View latest run/i }));
    expect(useUiStore.getState().section).toBe("invocations");
    expect(useUiStore.getState().selectedInvocationId).toBe("inv_auto_failed_new");
  });

  it("approves and retries a wrapper run when per-run approval is required", async () => {
    apiMock.fetchState.mockResolvedValue(closedLoopConsoleState());
    apiMock.approveApproval.mockResolvedValue({ approval: { id: "apr_run", status: "approved" } });
    apiMock.createCapabilityInvocation
      .mockResolvedValueOnce({ approvalRequestId: "apr_run", status: "waiting_for_local_approval" })
      .mockResolvedValueOnce({ invocationId: "inv_after_approval", status: "queued" });
    apiMock.listApplicationCapabilities.mockResolvedValue({
      applicationId: "app_ccusage",
      capabilities: [{
        name: "app.app_ccusage.wrapper.session",
        displayName: "ccusage Session Report",
        provider: { type: "application", id: "app_ccusage" },
        kind: "npm_wrapper",
        riskLevel: "medium",
        status: "available",
        requiresApproval: true,
        metadata: {
          readiness: { state: "ready", reason: "wrapper_installed", executionMode: "bridge_wrapper" },
          wrapper: { commandId: "session", policySupported: true, argInputs: [] },
        },
      }],
    });

    useUiStore.setState({ selectedApplicationId: "app_ccusage" });
    renderWithClient(createElement(ApplicationsInspector));

    fireEvent.click(await screen.findByRole("button", { name: /^Run$/i }, { timeout: 10_000 }));

    await waitFor(() => expect(apiMock.approveApproval).toHaveBeenCalledWith("apr_run"));
    expect(apiMock.createCapabilityInvocation).toHaveBeenNthCalledWith(1, "app.app_ccusage.wrapper.session", {});
    expect(apiMock.createCapabilityInvocation).toHaveBeenNthCalledWith(2, "app.app_ccusage.wrapper.session", { approvalRequestId: "apr_run" });
    expect(useUiStore.getState().selectedInvocationId).toBe("inv_after_approval");
  });

  it("grants wrapper policy consent before running a policy-blocked command", async () => {
    apiMock.fetchState.mockResolvedValue(closedLoopConsoleState());
    apiMock.approveApproval.mockResolvedValue({ approval: { id: "apr_policy", status: "approved" } });
    apiMock.grantApplicationWrapperPolicyConsent
      .mockResolvedValueOnce({ approvalRequestId: "apr_policy", status: "waiting_for_local_approval" })
      .mockResolvedValueOnce({ consent: { state: "granted" } });
    apiMock.createCapabilityInvocation.mockResolvedValueOnce({ invocationId: "inv_policy_run", status: "queued" });
    apiMock.listApplicationCapabilities.mockResolvedValue({
      applicationId: "app_ccusage",
      capabilities: [{
        name: "app.app_ccusage.wrapper.deploy",
        displayName: "Deploy",
        provider: { type: "application", id: "app_ccusage" },
        kind: "npm_wrapper",
        riskLevel: "high",
        status: "disabled",
        requiresApproval: true,
        metadata: {
          readiness: { state: "needs_consent", reason: "wrapper_policy_requires_explicit_consent", executionMode: "bridge_wrapper" },
          wrapper: {
            commandId: "deploy",
            policySupported: false,
            filePolicy: "workspace_write",
            networkPolicy: "network",
            argInputs: [],
          },
        },
      }],
    });

    useUiStore.setState({ selectedApplicationId: "app_ccusage" });
    renderWithClient(createElement(ApplicationsInspector));

    fireEvent.click(await screen.findByRole("button", { name: /^Run$/i }, { timeout: 10_000 }));

    await waitFor(() => expect(apiMock.grantApplicationWrapperPolicyConsent).toHaveBeenCalledTimes(2));
    expect(apiMock.approveApproval).toHaveBeenCalledWith("apr_policy");
    expect(apiMock.grantApplicationWrapperPolicyConsent).toHaveBeenNthCalledWith(
      1,
      "app_ccusage",
      "deploy",
      { reason: "Allow wrapper command deploy policy for app.app_ccusage.wrapper.deploy." },
    );
    expect(apiMock.grantApplicationWrapperPolicyConsent).toHaveBeenNthCalledWith(
      2,
      "app_ccusage",
      "deploy",
      {
        approvalRequestId: "apr_policy",
        reason: "Allow wrapper command deploy policy for app.app_ccusage.wrapper.deploy.",
      },
    );
    expect(apiMock.createCapabilityInvocation).toHaveBeenCalledWith("app.app_ccusage.wrapper.deploy", {});
    expect(useUiStore.getState().selectedInvocationId).toBe("inv_policy_run");
  });

  it("revokes granted wrapper policy consent from a wrapper capability", async () => {
    apiMock.fetchState.mockResolvedValue(closedLoopConsoleState());
    apiMock.revokeApplicationWrapperPolicyConsent.mockResolvedValue({ consent: { state: "revoked" } });
    apiMock.listApplicationCapabilities.mockResolvedValue({
      applicationId: "app_ccusage",
      capabilities: [{
        name: "app.app_ccusage.wrapper.deploy",
        displayName: "Deploy",
        provider: { type: "application", id: "app_ccusage" },
        kind: "npm_wrapper",
        riskLevel: "high",
        status: "available",
        requiresApproval: true,
        metadata: {
          readiness: { state: "ready", reason: "wrapper_policy_consent_granted", executionMode: "bridge_wrapper" },
          wrapper: {
            commandId: "deploy",
            policySupported: true,
            filePolicy: "workspace_write",
            networkPolicy: "network",
            policyConsent: {
              state: "granted",
              grantedAt: "2026-07-04T03:00:00.000Z",
              expiresAt: "2026-08-04T03:00:00.000Z",
              reason: "Allow deploy.",
            },
            argInputs: [],
          },
        },
      }],
    });

    useUiStore.setState({ selectedApplicationId: "app_ccusage" });
    renderWithClient(createElement(ApplicationsInspector));

    fireEvent.click(await screen.findByRole("button", { name: /Revoke consent/i }, { timeout: 10_000 }));

    await waitFor(() => expect(apiMock.revokeApplicationWrapperPolicyConsent).toHaveBeenCalledWith(
      "app_ccusage",
      "deploy",
      { reason: "Revoke wrapper command deploy policy for app.app_ccusage.wrapper.deploy." },
    ));
    expect(await screen.findByText("Policy consent revoked.")).toBeTruthy();
  });

  it("summarizes and filters application timeline events by level", async () => {
    apiMock.fetchState.mockResolvedValue(closedLoopConsoleState());
    apiMock.listApplicationCapabilities.mockResolvedValue({
      applicationId: "app_ccusage",
      capabilities: [],
    });
    apiMock.listApplicationEvents.mockResolvedValue({
      applicationId: "app_ccusage",
      events: [{
        id: "evt_app_error",
        invocationId: null,
        type: "application_probe_failed",
        level: "error",
        message: "Probe failed because package metadata was missing.",
        data: { applicationId: "app_ccusage", action: "probe" },
        createdAt: "2026-07-04T03:03:00.000Z",
      }, {
        id: "evt_app_warn",
        invocationId: null,
        type: "application_wrapper_warning",
        level: "warn",
        message: "Wrapper install is not complete.",
        data: { applicationId: "app_ccusage", status: "registered" },
        createdAt: "2026-07-04T03:02:00.000Z",
      }, {
        id: "evt_app_info",
        invocationId: null,
        type: "application_registered",
        level: "info",
        message: "Application registered.",
        data: { applicationId: "app_ccusage", sourceType: "npm" },
        createdAt: "2026-07-04T03:01:00.000Z",
      }],
    });

    useUiStore.setState({ selectedApplicationId: "app_ccusage" });
    renderWithClient(createElement(ApplicationsInspector));

    expect(await screen.findByText("1 error")).toBeTruthy();
    expect(screen.getByText("3 of 3 event(s)")).toBeTruthy();
    expect(screen.getByText(/Latest attention item: Probe failed/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Errors 1/i }));
    expect(screen.getByText("1 of 3 event(s)")).toBeTruthy();
    expect(screen.getByText("application_probe_failed")).toBeTruthy();
    expect(screen.queryByText("application_wrapper_warning")).toBeNull();
    expect(screen.queryByText("application_registered")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Warnings 1/i }));
    expect(screen.getByText("application_wrapper_warning")).toBeTruthy();
    expect(screen.queryByText("application_probe_failed")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Info 1/i }));
    expect(screen.getByText("application_registered")).toBeTruthy();
    expect(screen.queryByText("application_wrapper_warning")).toBeNull();
  });

  it("shows application run history diagnostics and filters timeline by capability", async () => {
    const state = closedLoopConsoleState();
    state.invocations = [{
      id: "inv_daily_failed",
      status: "failed",
      agentId: "agt_platform_application_wrapper",
      createdAt: "2026-07-04T04:00:00.000Z",
      options: {
        metadata: {
          providerType: "application",
          applicationId: "app_ccusage",
          capability: "app.app_ccusage.wrapper.daily",
          applicationWrapper: { commandId: "daily" },
        },
      },
    }, {
      id: "inv_weekly_ok",
      status: "succeeded",
      agentId: "agt_platform_application_wrapper",
      createdAt: "2026-07-04T03:30:00.000Z",
      result: { summary: "Weekly report imported." },
      options: {
        metadata: {
          providerType: "application",
          applicationId: "app_ccusage",
          capability: "app.app_ccusage.wrapper.weekly",
          applicationWrapper: { commandId: "weekly" },
        },
      },
    }];
    state.auditSummaries = [{
      invocationId: "inv_daily_failed",
      errorSummary: "agent_not_available: Application Wrapper Runner is not available.",
    }];
    apiMock.fetchState.mockResolvedValue(state);
    apiMock.listApplicationCapabilities.mockResolvedValue({
      applicationId: "app_ccusage",
      capabilities: [{
        name: "app.app_ccusage.wrapper.daily",
        displayName: "Daily",
        provider: { type: "application", id: "app_ccusage" },
        kind: "npm_wrapper",
        riskLevel: "low",
        status: "available",
        requiresApproval: false,
        metadata: {
          readiness: { state: "ready", reason: "wrapper_installed", executionMode: "bridge_wrapper" },
          wrapper: { commandId: "daily", policySupported: true, argInputs: [] },
        },
      }, {
        name: "app.app_ccusage.wrapper.weekly",
        displayName: "Weekly",
        provider: { type: "application", id: "app_ccusage" },
        kind: "npm_wrapper",
        riskLevel: "low",
        status: "available",
        requiresApproval: false,
        metadata: {
          readiness: { state: "ready", reason: "wrapper_installed", executionMode: "bridge_wrapper" },
          wrapper: { commandId: "weekly", policySupported: true, argInputs: [] },
        },
      }],
    });
    apiMock.listApplicationEvents.mockResolvedValue({
      applicationId: "app_ccusage",
      events: [{
        id: "evt_daily",
        invocationId: "inv_daily_failed",
        type: "application_wrapper_failed",
        level: "error",
        message: "Daily failed.",
        data: { applicationId: "app_ccusage", capability: "app.app_ccusage.wrapper.daily", commandId: "daily" },
        createdAt: "2026-07-04T04:01:00.000Z",
      }, {
        id: "evt_weekly",
        invocationId: "inv_weekly_ok",
        type: "application_wrapper_completed",
        level: "info",
        message: "Weekly completed.",
        data: { applicationId: "app_ccusage", capability: "app.app_ccusage.wrapper.weekly", commandId: "weekly" },
        createdAt: "2026-07-04T03:31:00.000Z",
      }],
    });

    useUiStore.setState({ selectedApplicationId: "app_ccusage" });
    renderWithClient(createElement(ApplicationsInspector));

    expect(await screen.findByText("Latest activity")).toBeTruthy();
    expect(screen.getAllByText("Agent unavailable").length).toBeGreaterThan(0);
    expect(screen.getByText(/Register or enable the required application runner/)).toBeTruthy();
    expect(await screen.findByText("inv_daily_failed")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Application event capability filter"), {
      target: { value: "app.app_ccusage.wrapper.weekly" },
    });

    expect(screen.getByText("Weekly completed.")).toBeTruthy();
    expect(screen.queryByText("Daily failed.")).toBeNull();
  });

  it("edits existing npm wrapper descriptors from the inspector", async () => {
    apiMock.fetchState.mockResolvedValue(closedLoopConsoleState());
    apiMock.listApplicationCapabilities.mockResolvedValue({
      applicationId: "app_ccusage",
      capabilities: [],
    });
    apiMock.getApplicationDescriptors.mockResolvedValue({
      applicationId: "app_ccusage",
      descriptors: {
        mcpAgent: null,
        npmWrapper: {
          mode: "installed-wrapper",
          installState: "installed",
          packageManager: "npm",
          commands: [{ id: "daily", commandType: "bin", command: "ccusage", status: "approved" }],
        },
        manualManifest: null,
      },
    });
    apiMock.updateApplicationDescriptors.mockResolvedValue({
      application: { id: "app_ccusage", name: "ccusage" },
      capabilities: [],
      descriptors: null,
    });

    useUiStore.setState({ selectedApplicationId: "app_ccusage" });
    renderWithClient(createElement(ApplicationsInspector));

    expect(await screen.findByText("Descriptors")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Edit descriptors/i }));

    const wrapperEditor = await screen.findByLabelText("npm wrapper descriptor JSON");
    await waitFor(() => {
      expect((wrapperEditor as HTMLTextAreaElement).value).toContain('"command": "ccusage"');
    });

    fireEvent.change(screen.getByLabelText("Wrapper command id"), { target: { value: "weekly" } });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Weekly usage" } });
    fireEvent.change(screen.getByLabelText("Command type"), { target: { value: "bin" } });
    fireEvent.change(screen.getByLabelText("Command"), { target: { value: "ccusage" } });
    fireEvent.change(screen.getByLabelText("Risk"), { target: { value: "low" } });
    fireEvent.click(screen.getByRole("button", { name: /Apply command draft/i }));

    expect((wrapperEditor as HTMLTextAreaElement).value).toContain('"id": "weekly"');
    expect((wrapperEditor as HTMLTextAreaElement).value).toContain('"id": "daily"');
    fireEvent.click(screen.getByRole("button", { name: /Save descriptors/i }));

    await waitFor(() => {
      expect(apiMock.updateApplicationDescriptors).toHaveBeenCalledWith("app_ccusage", {
        npmWrapper: {
          mode: "installed-wrapper",
          installState: "installed",
          packageManager: "npm",
          commands: [
            { id: "daily", commandType: "bin", command: "ccusage", status: "approved" },
            {
              id: "weekly",
              displayName: "Weekly usage",
              commandType: "bin",
              command: "ccusage",
              status: "approved",
              riskLevel: "low",
              requiresApproval: true,
              filePolicy: "read_only",
              networkPolicy: "forbidden",
            },
          ],
        },
      });
    });
  });

  it("applies Codex-generated descriptor drafts from the integration brief", async () => {
    const state = closedLoopConsoleState();
    state.applications![0] = {
      ...state.applications![0],
      integrationBrief: {
        version: "application-intake.v1",
        status: "draft",
        intent: "Import daily report evidence.",
        sourceType: "npm",
        invokableCapabilities: ["daily report"],
        fixedCommands: ["daily"],
        dataBoundary: "Read local report input.",
        smokeTests: ["register", "probe", "invoke"],
      },
    };
    apiMock.fetchState.mockResolvedValue(state);
    apiMock.listApplicationCapabilities.mockResolvedValue({
      applicationId: "app_ccusage",
      capabilities: [],
    });
    apiMock.getApplicationDescriptors.mockResolvedValue({
      applicationId: "app_ccusage",
      descriptors: {
        mcpAgent: null,
        npmWrapper: null,
        manualManifest: null,
      },
    });
    apiMock.updateApplicationDescriptors.mockResolvedValue({
      application: { id: "app_ccusage", name: "ccusage" },
      capabilities: [],
      descriptors: null,
    });

    useUiStore.setState({ selectedApplicationId: "app_ccusage" });
    renderWithClient(createElement(ApplicationsInspector));

    expect(await screen.findByText("Codex draft inputs saved")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Edit descriptors/i }));
    const wrapperEditor = await screen.findByLabelText("npm wrapper descriptor JSON");
    await waitFor(() => {
      expect(apiMock.getApplicationDescriptors).toHaveBeenCalledWith("app_ccusage");
    });
    expect(screen.getByText("Review checklist")).toBeTruthy();
    expect(screen.getByText("Smoke test plan")).toBeTruthy();
    expect(screen.getByText("Replace placeholder commands, args, cwd, URLs, and tool names before saving.")).toBeTruthy();
    expect(screen.getByText("register")).toBeTruthy();
    expect(screen.getByText("probe")).toBeTruthy();
    expect(screen.getByText("invoke")).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: /Apply npm wrapper draft/i }));

    expect(apiMock.updateApplicationDescriptors).not.toHaveBeenCalled();
    expect((wrapperEditor as HTMLTextAreaElement).value).toContain('"status": "draft"');
    expect((wrapperEditor as HTMLTextAreaElement).value).toContain('"requiresApproval": true');
    expect(screen.getByText("Descriptor risk preview")).toBeTruthy();
    expect(screen.getByText("0 projected")).toBeTruthy();
    expect(screen.getByText("2 draft/candidate")).toBeTruthy();
    expect(screen.getByText("2 approval")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Save descriptors/i }));

    await waitFor(() => {
      expect(apiMock.updateApplicationDescriptors).toHaveBeenCalledWith("app_ccusage", {
        npmWrapper: {
          mode: "installed-wrapper",
          installState: "unknown",
          packageManager: "npm",
          commands: [
            {
              id: "daily",
              displayName: "Daily",
              description: "Import daily report evidence.",
              commandType: "npm_script",
              command: "daily",
              status: "draft",
              riskLevel: "medium",
              riskTags: ["draft", "operator_review_required"],
              requiresApproval: true,
              filePolicy: "read_only",
              networkPolicy: "forbidden",
            },
            {
              id: "daily-report",
              displayName: "Daily Report",
              description: "Import daily report evidence.",
              commandType: "npm_script",
              command: "daily-report",
              status: "draft",
              riskLevel: "medium",
              riskTags: ["draft", "operator_review_required"],
              requiresApproval: true,
              filePolicy: "read_only",
              networkPolicy: "forbidden",
            },
          ],
        },
      });
    });
  });

  it("shows post-save descriptor next actions and runs probe", async () => {
    const writeText = mockClipboard();
    const state = closedLoopConsoleState();
    state.applications![0] = {
      ...state.applications![0],
      lifecycle: {
        lastOperation: "update_descriptors",
        lastOperationAt: "2026-07-08T02:00:00.000Z",
      },
      probe: {
        status: "completed",
        checkedAt: "2026-07-08T01:00:00.000Z",
      },
      wrapper: {
        mode: "installed-wrapper",
        installState: "installed",
        commands: [{
          id: "deploy",
          status: "approved",
          filePolicy: "workspace_write",
          networkPolicy: "network",
        }],
      },
      integrationBrief: {
        version: "application-intake.v1",
        status: "draft",
        smokeTests: ["register", "probe", "invoke"],
      },
      orchestrationIds: [],
    };
    apiMock.fetchState.mockResolvedValue(state);
    apiMock.listApplicationCapabilities.mockResolvedValue({
      applicationId: "app_ccusage",
      capabilities: [],
    });
    apiMock.applicationLifecycle.mockResolvedValue({ application: { id: "app_ccusage" } });

    useUiStore.setState({ selectedApplicationId: "app_ccusage" });
    renderWithClient(createElement(ApplicationsInspector));

    expect(await screen.findByText("Descriptor next actions")).toBeTruthy();
    expect(screen.getAllByText("Probe descriptors").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Review policy consent").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Generate orchestration").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Run smoke path").length).toBeGreaterThan(0);
    expect(screen.getByText("Smoke path checklist")).toBeTruthy();
    expect(screen.getByText("0/3 done")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Evidence note for register"), {
      target: { value: "Registered app_ccusage and descriptors saved." },
    });
    expect((screen.getByLabelText("Evidence note for register") as HTMLInputElement).value).toBe(
      "Registered app_ccusage and descriptors saved.",
    );
    expect(screen.getByText("Evidence draft preview")).toBeTruthy();
    expect(screen.getByText(/"completedCount": 0/)).toBeTruthy();
    expect(screen.getByText(/"note": "Registered app_ccusage and descriptors saved."/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Mark register done/i }));

    expect(screen.getByText("1/3 done")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Done register/i }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/"completedCount": 1/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Copy draft/i }));

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"type": "application_smoke_evidence_draft"'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"completedCount": 1'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"note": "Registered app_ccusage and descriptors saved."'));
    expect(screen.getByText("Copied evidence draft.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Save evidence/i }));

    await waitFor(() => {
      expect(apiMock.saveApplicationSmokeEvidence).toHaveBeenCalledWith("app_ccusage", {
        type: "application_smoke_evidence_draft",
        applicationId: "app_ccusage",
        applicationName: "ccusage",
        descriptorOperationAt: "2026-07-08T02:00:00.000Z",
        completedCount: 1,
        stepCount: 3,
        repoPath: null,
        summary: "Application smoke evidence for ccusage · 1/3 checks complete · register",
        steps: expect.arrayContaining([
          expect.objectContaining({
            step: "register",
            completed: true,
            note: "Registered app_ccusage and descriptors saved.",
          }),
        ]),
      });
    });
    expect(await screen.findByText(/Saved app_smoke_1/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /View evidence/i }));
    expect(useUiStore.getState().section).toBe("audit");
    expect(useUiStore.getState().selectedEvidenceId).toBe("app_smoke_1");

    fireEvent.click(screen.getByRole("button", { name: /Run probe/i }));

    await waitFor(() => {
      expect(apiMock.applicationLifecycle).toHaveBeenCalledWith("app_ccusage", "probe");
    });
  });

  it("continues onboarding guidance after registration", async () => {
    const state = closedLoopConsoleState();
    state.applications![0] = {
      ...state.applications![0],
      lifecycle: {
        lastOperation: "update_descriptors",
        lastOperationAt: "2026-07-08T02:00:00.000Z",
      },
      probe: {
        status: "completed",
        checkedAt: "2026-07-08T01:00:00.000Z",
      },
      integrationBrief: {
        version: "application-intake.v1",
        status: "draft",
        intent: "Import daily report evidence.",
        sourceType: "npm",
        invokableCapabilities: ["daily report"],
        fixedCommands: ["daily"],
        dataBoundary: "Read local report input.",
        smokeTests: ["register", "probe", "invoke"],
      },
      orchestrationIds: [],
    };
    apiMock.fetchState.mockResolvedValue(state);
    apiMock.listApplicationCapabilities.mockResolvedValue({
      applicationId: "app_ccusage",
      capabilities: [],
    });

    useUiStore.setState({ selectedApplicationId: "app_ccusage" });
    renderWithClient(createElement(ApplicationsInspector));

    expect(await screen.findByText("Onboarding continuity")).toBeTruthy();
    expect(screen.getByText("3/4 onboarding inputs ready")).toBeTruthy();
    expect(screen.getByText("Descriptor drafts available")).toBeTruthy();
    expect(screen.getAllByText("npm wrapper draft").length).toBeGreaterThan(0);
    expect(screen.getByText("Post-save next actions")).toBeTruthy();
    expect(screen.getByText("3 open")).toBeTruthy();
    expect(screen.getAllByText("Probe descriptors").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Run smoke path").length).toBeGreaterThan(0);
  });

  it("surfaces the ccusage operation case and runs the stable facade", async () => {
    const writeText = mockClipboard();
    apiMock.fetchState.mockResolvedValue({
      ...closedLoopConsoleState(),
      currentProjectId: "prj_local",
    });
    apiMock.listApplicationCapabilities.mockResolvedValue({
      applicationId: "app_ccusage",
      capabilities: [{
        name: "app.app_ccusage.wrapper.daily",
        displayName: "ccusage Daily Report",
        kind: "npm_wrapper",
        status: "available",
        riskLevel: "low",
        metadata: {
          wrapper: { commandId: "daily" },
          resultPath: { outputCollection: "importedUsageEstimates" },
        },
      }, {
        name: "app.app_ccusage.wrapper.weekly",
        displayName: "ccusage Weekly Report",
        kind: "npm_wrapper",
        status: "available",
        riskLevel: "low",
        metadata: {
          wrapper: { commandId: "weekly" },
          resultPath: { outputCollection: "importedUsageEstimates" },
        },
      }],
    });
    apiMock.createToolInvocation.mockResolvedValue({ invocationId: "inv_ccusage_daily", status: "queued" });

    useUiStore.setState({ selectedApplicationId: "app_ccusage" });
    renderWithClient(createElement(ApplicationsInspector));

    expect(await screen.findByText("ccusage operation case")).toBeTruthy();
    expect(screen.getByText("Discover governed report capabilities")).toBeTruthy();
    expect(screen.getByText("Run the stable ccusage.report facade")).toBeTruthy();
    expect(screen.getByText("Inspect imported usage evidence")).toBeTruthy();
    expect(await screen.findByText(/2 wrapper report capabilities are projected/)).toBeTruthy();
    expect(screen.getByText("ccusage.report facade")).toBeTruthy();
    expect(screen.getAllByText("importedUsageEstimates").length).toBeGreaterThan(0);
    expect(screen.getByText("1 imported row(s)")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open deep link/i }).getAttribute("href")).toBe(
      "/?section=applications&application=app_ccusage",
    );
    fireEvent.click(screen.getByRole("button", { name: /Copy walkthrough path/i }));
    expect(writeText).toHaveBeenCalledWith("docs/engineering/CCUSAGE_APPLICATION_USE_CASE.md");
    expect(screen.getByText("Copied walkthrough path.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Run daily report/i }));

    await waitFor(() => {
      expect(apiMock.createToolInvocation).toHaveBeenCalledWith("ccusage.report", {
        report: "daily",
        source: "all",
        offline: true,
        projectId: "prj_local",
      });
    });
    expect(await screen.findByText("inv_ccusage_daily")).toBeTruthy();
    expect(screen.getByText(/Daily report queued/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /View created invocation/i }));
    expect(useUiStore.getState().section).toBe("invocations");
    expect(useUiStore.getState().selectedInvocationId).toBe("inv_ccusage_daily");
  });

  it("matches ccusage wrapper capabilities from the selected application id", async () => {
    const state = closedLoopConsoleState();
    state.applications![0] = {
      ...state.applications![0],
      id: "app_team_ccusage",
      latestResult: {
        ...state.applications![0].latestResult!,
        applicationId: "app_team_ccusage",
        capability: "app.app_team_ccusage.wrapper.daily",
      },
    };
    apiMock.fetchState.mockResolvedValue(state);
    apiMock.listApplicationCapabilities.mockResolvedValue({
      applicationId: "app_team_ccusage",
      capabilities: [{
        name: "app.app_team_ccusage.wrapper.daily",
        displayName: "ccusage Daily Report",
        kind: "npm_wrapper",
        status: "available",
        riskLevel: "low",
        metadata: {
          wrapper: { commandId: "daily" },
          resultPath: { outputCollection: "importedUsageEstimates" },
        },
      }, {
        name: "app.app_team_ccusage.wrapper.weekly",
        displayName: "ccusage Weekly Report",
        kind: "npm_wrapper",
        status: "available",
        riskLevel: "low",
        metadata: {
          wrapper: { commandId: "weekly" },
          resultPath: { outputCollection: "importedUsageEstimates" },
        },
      }, {
        name: "app.app_ccusage.wrapper.monthly",
        displayName: "Other ccusage Monthly Report",
        kind: "npm_wrapper",
        status: "available",
        riskLevel: "low",
        metadata: {
          wrapper: { commandId: "monthly" },
          resultPath: { outputCollection: "importedUsageEstimates" },
        },
      }],
    });

    useUiStore.setState({ selectedApplicationId: "app_team_ccusage" });
    renderWithClient(createElement(ApplicationsInspector));

    expect(await screen.findByText("ccusage operation case")).toBeTruthy();
    expect(await screen.findByText(/2 wrapper report capabilities are projected/)).toBeTruthy();
    expect(screen.getByText("wrapper.daily")).toBeTruthy();
    expect(screen.getByText("wrapper.weekly")).toBeTruthy();
    expect(screen.queryByText("wrapper.monthly")).toBeNull();
  });

  it("humanizes ccusage wrapper runner path failures", async () => {
    const state = closedLoopConsoleState();
    state.invocations![0] = {
      ...state.invocations![0],
      status: "failed",
      explanation: {
        state: "failed",
        reason: "Error: Cannot find module 'D:\\repo\\project\\tools\\agents\\application-wrapper.mjs'",
        reasonCode: "failed",
        summary: "Error: Cannot find module application-wrapper.mjs",
        waitingOn: null,
        resultLocation: null,
        nextAction: "Review the timeline.",
        recovery: null,
        approval: null,
        source: { type: "application_orchestration", applicationId: "app_ccusage" },
      },
    };
    state.applications![0] = {
      ...state.applications![0],
      latestResult: {
        ...state.applications![0].latestResult!,
        status: "failed",
        importedRecordIds: [],
        importedRecordCount: 0,
      },
    };
    apiMock.fetchState.mockResolvedValue(state);
    apiMock.listApplicationCapabilities.mockResolvedValue({
      applicationId: "app_ccusage",
      capabilities: [{
        name: "app.app_ccusage.wrapper.daily",
        displayName: "ccusage Daily Report",
        kind: "npm_wrapper",
        status: "available",
        riskLevel: "low",
        metadata: {
          wrapper: { commandId: "daily" },
          resultPath: { outputCollection: "importedUsageEstimates" },
        },
      }],
    });

    useUiStore.setState({ selectedApplicationId: "app_ccusage" });
    renderWithClient(createElement(ApplicationsInspector));

    expect(await screen.findByText("ccusage operation case")).toBeTruthy();
    expect(screen.getAllByText("Error: Cannot find module application-wrapper.mjs").length).toBeGreaterThan(0);
    expect(screen.getByText(/Re-register the Application Wrapper Runner/)).toBeTruthy();
  });

  it("clears an existing MCP descriptor from the inspector", async () => {
    apiMock.fetchState.mockResolvedValue(mcpConsoleState());
    apiMock.listApplicationCapabilities.mockResolvedValue({
      applicationId: "app_doocs_md",
      capabilities: [],
    });
    apiMock.getApplicationDescriptors.mockResolvedValue({
      applicationId: "app_doocs_md",
      descriptors: {
        mcpAgent: {
          transport: "stdio",
          command: "node",
          args: ["server.mjs"],
          allowedTools: ["render_markdown"],
        },
        npmWrapper: null,
        manualManifest: null,
      },
    });
    apiMock.updateApplicationDescriptors.mockResolvedValue({
      application: { id: "app_doocs_md", name: "doocs/md" },
      capabilities: [],
      descriptors: null,
    });

    useUiStore.setState({ selectedApplicationId: "app_doocs_md" });
    renderWithClient(createElement(ApplicationsInspector));

    expect(await screen.findByText("Descriptors")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Edit descriptors/i }));
    await screen.findByLabelText("MCP descriptor JSON");
    fireEvent.click(screen.getByRole("button", { name: /Remove MCP descriptor/i }));
    fireEvent.click(screen.getByRole("button", { name: /Save descriptors/i }));

    await waitFor(() => {
      expect(apiMock.updateApplicationDescriptors).toHaveBeenCalledWith("app_doocs_md", {
        mcpAgent: null,
      });
    });
  });

  it("renders descriptor validation feedback from the inspector", async () => {
    apiMock.fetchState.mockResolvedValue(closedLoopConsoleState());
    apiMock.listApplicationCapabilities.mockResolvedValue({
      applicationId: "app_ccusage",
      capabilities: [],
    });
    apiMock.getApplicationDescriptors.mockResolvedValue({
      applicationId: "app_ccusage",
      descriptors: {
        mcpAgent: null,
        npmWrapper: {
          mode: "installed-wrapper",
          installState: "installed",
          packageManager: "npm",
          commands: [{ id: "daily", commandType: "bin", command: "ccusage", status: "approved" }],
        },
        manualManifest: null,
      },
    });
    const { ApiError } = await import("@/lib/api-client");
    apiMock.updateApplicationDescriptors.mockRejectedValue(new ApiError({
      status: 422,
      method: "PATCH",
      path: "/api/applications/app_ccusage/descriptors",
      body: {
        error: "invalid_application_descriptor",
        applicationId: "app_ccusage",
        validation: {
          errors: [{
            path: "npmWrapper.commands[0].command",
            code: "invalid_command",
            message: "Command must not contain newlines.",
          }, {
            path: "npmWrapper.packageManager",
            code: "invalid_package_manager",
            message: "packageManager must be npm, pnpm, or yarn.",
          }],
        },
      },
    }));

    useUiStore.setState({ selectedApplicationId: "app_ccusage" });
    renderWithClient(createElement(ApplicationsInspector));

    expect(await screen.findByText("Descriptors")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Edit descriptors/i }));
    const wrapperEditor = await screen.findByLabelText("npm wrapper descriptor JSON");
    fireEvent.change(wrapperEditor, {
      target: {
        value: JSON.stringify({
          mode: "installed-wrapper",
          packageManager: "bun",
          commands: [{ id: "daily", commandType: "custom", command: "node\nbad", status: "approved" }],
        }),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save descriptors/i }));

    expect(await screen.findByText("Descriptor feedback")).toBeTruthy();
    expect(screen.getByText(/code invalid_application_descriptor/)).toBeTruthy();
    expect(screen.getByText(/application app_ccusage/)).toBeTruthy();
    expect(screen.getByText("npmWrapper.commands[0].command:")).toBeTruthy();
    expect(screen.getByText("Command must not contain newlines.")).toBeTruthy();
    expect(screen.getByText("npmWrapper.packageManager:")).toBeTruthy();
    expect(screen.getByText("packageManager must be npm, pnpm, or yarn.")).toBeTruthy();
  });

  it("covers Result Center operations in a focused split test", async () => {
    const writeText = mockClipboard();
    apiMock.fetchState.mockResolvedValue(mcpConsoleState());
    apiMock.listApplicationCapabilities.mockResolvedValue({ applicationId: "app_doocs_md", capabilities: [] });
    apiMock.listApplicationResults.mockResolvedValue({
      applicationId: "app_doocs_md",
      count: 2,
      results: [{
        id: "app_render_split",
        applicationId: "app_doocs_md",
        invocationId: "inv_doocs_render",
        agentId: "agt_app_doocs_md_mcp",
        capability: "doocs_md.render_markdown",
        mcpToolName: "render_markdown",
        artifactType: "html",
        evidenceType: "rendered_markdown",
        theme: "github",
        markdownHash: "a".repeat(64),
        htmlHash: "b".repeat(64),
        htmlByteLength: 28,
        htmlSummary: "Focused result center render.",
        resultRef: { type: "application_render_result", id: "app_render_split", href: "/api/applications/app_doocs_md/results/app_render_split" },
        generatedAt: "2026-07-05T04:03:00.000Z",
        createdAt: "2026-07-05T04:03:00.000Z",
        updatedAt: "2026-07-05T04:03:00.000Z",
      }, {
        id: "app_artifact_split",
        applicationId: "app_doocs_md",
        invocationId: "inv_doocs_themes",
        agentId: "agt_app_doocs_md_mcp",
        capability: "doocs_md.list_themes",
        mcpToolName: "list_themes",
        outputCollection: "applicationResultArtifacts",
        artifactType: "option_catalog",
        evidenceType: "mcp_option_catalog",
        summary: "Focused themes catalog.",
        htmlSummary: "Focused themes catalog.",
        dataHash: "c".repeat(64),
        byteLength: 96,
        resultRef: { type: "application_result_artifact", id: "app_artifact_split", href: "/api/applications/app_doocs_md/results/app_artifact_split" },
        generatedAt: "2026-07-05T04:02:00.000Z",
        createdAt: "2026-07-05T04:02:00.000Z",
        updatedAt: "2026-07-05T04:02:00.000Z",
      }],
    });

    useUiStore.setState({ selectedApplicationId: "app_doocs_md" });
    renderWithClient(createElement(ApplicationsInspector));

    expect(await screen.findByText("Results")).toBeTruthy();
    const resultsHistoryCard = document.querySelector<HTMLElement>('[data-application-panel="results-history"]');
    expect(resultsHistoryCard).toBeTruthy();
    expect(await within(resultsHistoryCard as HTMLElement).findByText("Result operations")).toBeTruthy();
    expect(within(resultsHistoryCard as HTMLElement).getByText("2 visible · 2 total")).toBeTruthy();
    expect(within(resultsHistoryCard as HTMLElement).getByText("2 exportable")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Auto retention enabled"));
    fireEvent.change(screen.getByLabelText("Keep latest results"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: /Save policy/i }));
    await waitFor(() => {
      expect(apiMock.updateApplicationResultRetention).toHaveBeenCalledWith("app_doocs_md", {
        enabled: true,
        keepLatest: 3,
        archiveAfterDays: null,
      });
    });

    fireEvent.change(screen.getByLabelText("Search results"), { target: { value: "themes" } });
    await waitFor(() => {
      expect(apiMock.listApplicationResults).toHaveBeenCalledWith("app_doocs_md", { limit: 10, q: "themes" });
    });

    const renderResultCard = screen.getByText("app_render_split").closest("div.space-y-2");
    expect(renderResultCard).toBeTruthy();
    fireEvent.click(within(renderResultCard as HTMLElement).getByRole("button", { name: /Copy export/i }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"id": "app_render_split"'));

    fireEvent.click(within(renderResultCard as HTMLElement).getByRole("button", { name: /Save evidence/i }));
    await waitFor(() => {
      expect(apiMock.saveImportedEvidence).toHaveBeenCalledWith(expect.objectContaining({
        source: "application_result_center",
        summary: expect.stringContaining("Application result app_render_split"),
      }));
    });

    fireEvent.click(within(renderResultCard as HTMLElement).getByRole("button", { name: /^Pin$/i }));
    await waitFor(() => {
      expect(apiMock.updateApplicationResult).toHaveBeenCalledWith("app_doocs_md", "app_render_split", {
        pinned: true,
        note: "Pinned from Result Center.",
      });
    });
  });

  it("renders autodetected MCP tools and the Application-bound render result", async () => {
    const writeText = mockClipboard();
    apiMock.fetchState.mockResolvedValue(mcpConsoleState());
    apiMock.listApplicationCapabilities.mockResolvedValue({
      applicationId: "app_doocs_md",
      capabilities: [{
        name: "doocs_md.render_markdown",
        displayName: "render_markdown",
        riskLevel: "medium",
        status: "available",
        source: "mcp_agent",
        metadata: {
          readiness: { state: "ready", reason: "mcp_agent_registered", executionMode: "mcp_stdio" },
          resultPath: { outputCollection: "applicationRenderResults", evidenceCenter: true },
        },
      }, {
        name: "doocs_md.list_themes",
        displayName: "list_themes",
        kind: "mcp_tool",
        riskLevel: "medium",
        status: "available",
        source: "mcp_agent",
        inputSchema: { type: "object", additionalProperties: false, properties: {} },
        metadata: {
          readiness: { state: "ready", reason: "mcp_agent_registered", executionMode: "mcp_stdio" },
          resultPath: { outputCollection: "applicationResultArtifacts", evidenceCenter: true },
          mcp: {
            agentId: "agt_app_doocs_md_mcp",
            toolName: "list_themes",
            sharedToolName: "doocs_md.list_themes",
            inputSchema: { type: "object", additionalProperties: false, properties: {} },
          },
        },
      }],
    });
    apiMock.listApplicationResults.mockResolvedValue({
      applicationId: "app_doocs_md",
      count: 3,
      results: [{
        id: "app_render_2",
        applicationId: "app_doocs_md",
        invocationId: "inv_doocs_render",
        agentId: "agt_app_doocs_md_mcp",
        capability: "doocs_md.render_markdown",
        mcpToolName: "render_markdown",
        artifactType: "html",
        evidenceType: "rendered_markdown",
        theme: "github",
        markdownHash: "c".repeat(64),
        htmlHash: "d".repeat(64),
        htmlByteLength: 32,
        htmlSummary: "Second render from history.",
        resultRef: { type: "application_render_result", id: "app_render_2", href: "/api/applications/app_doocs_md/results/app_render_2" },
        generatedAt: "2026-07-05T04:02:00.000Z",
        createdAt: "2026-07-05T04:02:00.000Z",
        updatedAt: "2026-07-05T04:02:00.000Z",
      }, {
        id: "app_artifact_themes",
        applicationId: "app_doocs_md",
        invocationId: "inv_doocs_themes",
        agentId: "agt_app_doocs_md_mcp",
        capability: "doocs_md.list_themes",
        mcpToolName: "list_themes",
        outputCollection: "applicationResultArtifacts",
        artifactType: "option_catalog",
        evidenceType: "mcp_option_catalog",
        summary: "themes catalog from list_themes with 3 item(s).",
        htmlSummary: "themes catalog from list_themes with 3 item(s).",
        dataHash: "e".repeat(64),
        byteLength: 96,
        dataShape: { type: "object", catalogKey: "themes", itemCount: 3 },
        preview: { themes: [{ value: "default" }, { value: "grace" }, { value: "simple" }] },
        resultRef: { type: "application_result_artifact", id: "app_artifact_themes", href: "/api/applications/app_doocs_md/results/app_artifact_themes" },
        lineage: {
          source: "application_mcp_result",
          applicationId: "app_doocs_md",
          invocationId: "inv_doocs_themes",
          agentId: "agt_app_doocs_md_mcp",
          capability: "doocs_md.list_themes",
          mcpToolName: "list_themes",
          outputCollection: "applicationResultArtifacts",
        },
        generatedAt: "2026-07-05T04:01:30.000Z",
        createdAt: "2026-07-05T04:01:30.000Z",
        updatedAt: "2026-07-05T04:01:30.000Z",
      }, {
        id: "app_render_1",
        applicationId: "app_doocs_md",
        invocationId: "inv_doocs_render",
        agentId: "agt_app_doocs_md_mcp",
        capability: "doocs_md.render_markdown",
        mcpToolName: "render_markdown",
        artifactType: "html",
        evidenceType: "rendered_markdown",
        theme: "github",
        markdownHash: "a".repeat(64),
        htmlHash: "b".repeat(64),
        htmlByteLength: 28,
        htmlSummary: "Hello from doocs.",
        resultRef: { type: "application_render_result", id: "app_render_1", href: "/api/applications/app_doocs_md/results/app_render_1" },
        generatedAt: "2026-07-05T04:01:00.000Z",
        createdAt: "2026-07-05T04:01:00.000Z",
        updatedAt: "2026-07-05T04:01:00.000Z",
      }],
    });
    apiMock.createToolInvocation.mockResolvedValue({ invocationId: "inv_doocs_render_next", status: "queued" });

    useUiStore.setState({ selectedApplicationId: "app_doocs_md" });
    renderWithClient(createElement(ApplicationsInspector));

    expect(await screen.findByText("MCP tools")).toBeTruthy();
    const webEditorHeading = screen.getAllByText("Web editor").find((element) => element.tagName.toLowerCase() === "p");
    expect(webEditorHeading).toBeTruthy();
    expect(screen.getByText("Not running")).toBeTruthy();
    const webEditorCard = webEditorHeading?.closest("div.space-y-2");
    expect(webEditorCard).toBeTruthy();
    expect(within(webEditorCard as HTMLElement).getByText("latest handoff")).toBeTruthy();
    expect(within(webEditorCard as HTMLElement).getByText("Hello from doocs")).toBeTruthy();
    expect(within(webEditorCard as HTMLElement).getByText("app_render_1")).toBeTruthy();
    expect(within(webEditorCard as HTMLElement).getByText("18 chars")).toBeTruthy();
    expect(within(webEditorCard as HTMLElement).getByText("28 bytes")).toBeTruthy();
    fireEvent.click(within(webEditorCard as HTMLElement).getByRole("button", { name: /View latest editor result/i }));
    expect(useUiStore.getState().selectedApplicationResultId).toBe("app_render_1");
    expect(await screen.findByRole("dialog", { name: /Application result/i })).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Close"));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /Application result/i })).toBeNull();
    });
    fireEvent.click(screen.getByRole("button", { name: /Start editor/i }));
    await waitFor(() => {
      expect(apiMock.applicationWebEditor).toHaveBeenCalledWith("app_doocs_md", "start");
    });
    fireEvent.change(screen.getByLabelText("Editor Markdown"), {
      target: { value: "# Editor handoff" },
    });
    fireEvent.change(screen.getByLabelText("Editor HTML"), {
      target: { value: "<article><h1>Editor handoff</h1></article>" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save editor result/i }));
    await waitFor(() => {
      expect(apiMock.importApplicationEditorResult).toHaveBeenCalledWith("app_doocs_md", {
        markdown: "# Editor handoff",
        html: "<article><h1>Editor handoff</h1></article>",
        theme: "default",
        sourceUrl: null,
      });
    });
    const lifecycleCard = screen.getByText("Lifecycle").closest("div.rounded-xl");
    expect(lifecycleCard).toBeTruthy();
    fireEvent.click(within(lifecycleCard as HTMLElement).getByRole("button", { name: /^View result$/i }));
    expect(useUiStore.getState().selectedApplicationResultId).toBe("app_render_editor");

    expect((await screen.findAllByText("agt_app_doocs_md_mcp")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("doocs_md.render_markdown").length).toBeGreaterThan(0);
    expect(screen.getAllByText("doocs_md.list_themes").length).toBeGreaterThan(0);
    expect(screen.getByText("high confidence")).toBeTruthy();
    expect(screen.getByText("node_entrypoint_inside_application_root")).toBeTruthy();
    expect(screen.getAllByText("render_markdown").length).toBeGreaterThan(0);
    expect(screen.getAllByText("inv_doocs_render").length).toBeGreaterThan(0);
    expect(screen.getAllByText("applicationRenderResults").length).toBeGreaterThan(0);
    expect(screen.getAllByText("github").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Hello from doocs.").length).toBeGreaterThan(0);
    expect(screen.getByText("doocs/md quick actions")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Render sample/i }));
    await waitFor(() => {
      expect(apiMock.createToolInvocation).toHaveBeenCalledWith("doocs_md.render_markdown", {
        projectId: "prj_doocs",
        markdown: "# doocs/md preview\n\nThis safe sample validates the governed MCP render path.",
        theme: "default",
      });
    });
    fireEvent.click(screen.getByRole("button", { name: /List themes/i }));
    await waitFor(() => {
      expect(apiMock.createToolInvocation).toHaveBeenLastCalledWith("doocs_md.list_themes", {
        projectId: "prj_doocs",
      });
    });
    fireEvent.click(screen.getByRole("button", { name: /View latest result/i }));
    expect(useUiStore.getState().selectedApplicationResultId).toBe("app_render_1");
    expect(await screen.findByRole("dialog", { name: /Application result/i })).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Close"));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /Application result/i })).toBeNull();
    });
    expect(await screen.findByText("Second render from history.")).toBeTruthy();
    expect(await screen.findByText("themes catalog from list_themes with 3 item(s).")).toBeTruthy();
    expect(apiMock.listApplicationResults).toHaveBeenCalledWith("app_doocs_md", { limit: 10 });
    const resultsHistoryCard = document.querySelector<HTMLElement>('[data-application-panel="results-history"]');
    expect(resultsHistoryCard).toBeTruthy();
    expect(within(resultsHistoryCard as HTMLElement).getByText("Result operations")).toBeTruthy();
    expect(within(resultsHistoryCard as HTMLElement).getByText("3 visible · 3 total")).toBeTruthy();
    expect(within(resultsHistoryCard as HTMLElement).getByText("Active results")).toBeTruthy();
    expect(within(resultsHistoryCard as HTMLElement).getByText("Evidence-ready")).toBeTruthy();
    expect(within(resultsHistoryCard as HTMLElement).getByText("2 rerunnable")).toBeTruthy();
    expect(within(resultsHistoryCard as HTMLElement).getByText("3 exportable")).toBeTruthy();
    expect(within(resultsHistoryCard as HTMLElement).getByText("Retention")).toBeTruthy();
    expect(within(resultsHistoryCard as HTMLElement).getByText(/Last run/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Auto retention enabled"));
    fireEvent.change(screen.getByLabelText("Keep latest results"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Archive results after days"), { target: { value: "14" } });
    fireEvent.click(screen.getByRole("button", { name: /Save policy/i }));
    await waitFor(() => {
      expect(apiMock.updateApplicationResultRetention).toHaveBeenCalledWith("app_doocs_md", {
        enabled: true,
        keepLatest: 2,
        archiveAfterDays: 14,
      });
    });

    fireEvent.click(screen.getByRole("button", { name: /Run now/i }));
    await waitFor(() => {
      expect(apiMock.runApplicationResultRetention).toHaveBeenCalledWith("app_doocs_md");
    });

    fireEvent.change(screen.getByLabelText("Search results"), { target: { value: "themes" } });
    await waitFor(() => {
      expect(apiMock.listApplicationResults).toHaveBeenCalledWith("app_doocs_md", { limit: 10, q: "themes" });
    });
    fireEvent.change(screen.getByLabelText("Result type"), { target: { value: "artifact" } });
    await waitFor(() => {
      expect(apiMock.listApplicationResults).toHaveBeenCalledWith("app_doocs_md", { limit: 10, q: "themes", resultType: "artifact" });
    });
    fireEvent.change(screen.getByLabelText("Result source"), { target: { value: "application_web_editor" } });
    await waitFor(() => {
      expect(apiMock.listApplicationResults).toHaveBeenCalledWith("app_doocs_md", {
        limit: 10,
        q: "themes",
        resultType: "artifact",
        source: "application_web_editor",
      });
    });
    fireEvent.change(screen.getByLabelText("Artifact type"), { target: { value: "option_catalog" } });
    await waitFor(() => {
      expect(apiMock.listApplicationResults).toHaveBeenCalledWith("app_doocs_md", {
        limit: 10,
        q: "themes",
        resultType: "artifact",
        source: "application_web_editor",
        artifactType: "option_catalog",
      });
    });
    fireEvent.change(screen.getByLabelText("Governance"), { target: { value: "archived" } });
    await waitFor(() => {
      expect(apiMock.listApplicationResults).toHaveBeenCalledWith("app_doocs_md", {
        limit: 10,
        q: "themes",
        resultType: "artifact",
        source: "application_web_editor",
        artifactType: "option_catalog",
        archived: true,
      });
    });

    fireEvent.click(screen.getAllByRole("button", { name: /Copy export/i })[0]);
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"version": "application_result_export.v1"'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"id": "app_render_2"'));
    expect(await screen.findByText("Copied export for app_render_2.")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: /Save evidence/i })[0]);
    await waitFor(() => {
      expect(apiMock.saveImportedEvidence).toHaveBeenCalledWith({
        source: "application_result_center",
        repoPath: "C:\\apps\\doocs-md",
        summary: expect.stringContaining("Application result app_render_2"),
      });
    });
    expect(await screen.findByText("Saved evidence for app_render_2.")).toBeTruthy();

    const renderResultCard = screen.getByText("app_render_2").closest("div.space-y-2");
    expect(renderResultCard).toBeTruthy();
    fireEvent.click(within(renderResultCard as HTMLElement).getByRole("button", { name: /^Pin$/i }));
    await waitFor(() => {
      expect(apiMock.updateApplicationResult).toHaveBeenCalledWith("app_doocs_md", "app_render_2", {
        pinned: true,
        note: "Pinned from Result Center.",
      });
    });

    fireEvent.click(within(renderResultCard as HTMLElement).getByRole("button", { name: /^Archive$/i }));
    await waitFor(() => {
      expect(apiMock.updateApplicationResult).toHaveBeenCalledWith("app_doocs_md", "app_render_2", {
        archived: true,
        note: "Archived from Result Center.",
      });
    });

    fireEvent.click(screen.getByLabelText("Compare app_render_2"));
    fireEvent.click(screen.getByLabelText("Compare app_artifact_themes"));
    expect(await screen.findByText("Result compare")).toBeTruthy();
    expect(screen.getByText("app_render_2 vs app_artifact_themes")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Markdown"), {
      target: { value: "# Operator preview\n\nRendered through Desktop Bridge." },
    });
    fireEvent.change(screen.getByLabelText("Theme"), { target: { value: "github" } });
    fireEvent.click(screen.getByRole("button", { name: /Run render/i }));

    await waitFor(() => {
      expect(apiMock.createToolInvocation).toHaveBeenCalledWith("doocs_md.render_markdown", {
        projectId: "prj_doocs",
        markdown: "# Operator preview\n\nRendered through Desktop Bridge.",
        theme: "github",
      });
    });

    fireEvent.click(screen.getByRole("button", { name: /Run last input/i }));

    await waitFor(() => {
      expect(apiMock.createToolInvocation).toHaveBeenLastCalledWith("doocs_md.render_markdown", {
        projectId: "prj_doocs",
        markdown: "# Hello from doocs",
        theme: "github",
      });
    });

    fireEvent.click(screen.getByRole("button", { name: /Re-probe MCP/i }));

    await waitFor(() => {
      expect(apiMock.applicationLifecycle).toHaveBeenCalledWith("app_doocs_md", "probe");
    });

    fireEvent.click(screen.getByRole("button", { name: /Run list_themes/i }));

    await waitFor(() => {
      expect(apiMock.createToolInvocation).toHaveBeenLastCalledWith("doocs_md.list_themes", {
        projectId: "prj_doocs",
      });
    });

    const latestResultCard = screen.getByText("Latest result").closest("div.rounded-xl");
    expect(latestResultCard).toBeTruthy();
    fireEvent.click(within(latestResultCard as HTMLElement).getByRole("button", { name: /View result/i }));

    expect(useUiStore.getState().selectedApplicationResultId).toBe("app_render_1");
    expect(await screen.findByRole("dialog", { name: /Application result/i })).toBeTruthy();
    await waitFor(() => {
      expect(apiMock.getApplicationResult).toHaveBeenCalledWith("app_doocs_md", "app_render_1");
    });
    expect(screen.getByText("app_render_1 · github")).toBeTruthy();
    expect(screen.getByTitle("Rendered markdown result")).toBeTruthy();
    const resultDialog = within(screen.getByRole("dialog", { name: /Application result/i }));
    expect(resultDialog.getByText("retention manual")).toBeTruthy();
    expect(resultDialog.getByText(/manual only · keep latest 20/)).toBeTruthy();
    expect(resultDialog.getByText("Editor handoff")).toBeTruthy();
    expect(resultDialog.getByText("Web editor handoff")).toBeTruthy();
    expect(resultDialog.getByText("Hello from doocs")).toBeTruthy();
    expect(resultDialog.getByText("http://localhost:5173/md/?myagenttoolApplicationId=app_doocs_md")).toBeTruthy();
    expect(resultDialog.getByText("18 chars")).toBeTruthy();
    expect(resultDialog.getAllByText("28 bytes").length).toBeGreaterThan(0);
    fireEvent.click(resultDialog.getByRole("button", { name: /^Pin$/i }));
    await waitFor(() => {
      expect(apiMock.updateApplicationResult).toHaveBeenCalledWith("app_doocs_md", "app_render_1", {
        pinned: true,
        note: "Pinned from Result Center.",
      });
    });
    fireEvent.click(resultDialog.getByRole("button", { name: /^Archive$/i }));
    await waitFor(() => {
      expect(apiMock.updateApplicationResult).toHaveBeenCalledWith("app_doocs_md", "app_render_1", {
        archived: true,
        note: "Archived from Result Center.",
      });
    });
    fireEvent.click(resultDialog.getByRole("button", { name: /Copy export/i }));
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining('"version": "application_result_export.v1"'));
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining('"id": "app_render_1"'));
    expect(await resultDialog.findByText("Copied export.")).toBeTruthy();
    fireEvent.click(resultDialog.getByRole("button", { name: /Save evidence/i }));
    await waitFor(() => {
      expect(apiMock.saveImportedEvidence).toHaveBeenCalledWith({
        source: "application_result_center",
        repoPath: "C:\\apps\\doocs-md",
        summary: expect.stringContaining("Application result app_render_1"),
      });
    });
    expect(await resultDialog.findByText("Saved evidence.")).toBeTruthy();
    fireEvent.click(resultDialog.getByRole("button", { name: /Copy link/i }));
    expect(screen.getByText("Copied result link.")).toBeTruthy();
    const copiedResultUrl = new URL(writeText.mock.calls[writeText.mock.calls.length - 1]?.[0] as string);
    expect(copiedResultUrl.searchParams.get("section")).toBe("applications");
    expect(copiedResultUrl.searchParams.get("application")).toBe("app_doocs_md");
    expect(copiedResultUrl.searchParams.get("applicationResult")).toBe("app_render_1");

    fireEvent.click(screen.getAllByRole("button", { name: /^Rerun$/i })[0]);

    await waitFor(() => {
      expect(apiMock.createToolInvocation).toHaveBeenLastCalledWith("doocs_md.render_markdown", {
        projectId: "prj_doocs",
        markdown: "# Hello from doocs",
        theme: "github",
      });
    });

    fireEvent.click(screen.getAllByRole("button", { name: /View invocation/i })[0]);

    expect(useUiStore.getState().section).toBe("invocations");
    expect(useUiStore.getState().selectedInvocationId).toBe("inv_doocs_render");
  }, 45_000);

  it("stops a ready doocs/md web editor from the lifecycle card", async () => {
    const state = mcpConsoleState();
    state.applications![0].webEditor = {
      available: true,
      status: "ready",
      reason: "bridge_started",
      commandLabel: "pnpm run start",
      url: "http://localhost:5173/md/",
      pid: 1234,
      actionId: "app_editor_start",
      summary: "Application editor is ready at http://localhost:5173/md/.",
    };
    apiMock.fetchState.mockResolvedValue(state);
    apiMock.listApplicationCapabilities.mockResolvedValue({
      applicationId: "app_doocs_md",
      capabilities: [],
    });

    useUiStore.setState({ selectedApplicationId: "app_doocs_md" });
    renderWithClient(createElement(ApplicationsInspector));

    expect((await screen.findAllByText("Web editor")).length).toBeGreaterThan(0);
    expect(screen.getByText("Ready")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Open editor/i }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /^Stop$/i }));

    await waitFor(() => {
      expect(apiMock.applicationWebEditor).toHaveBeenCalledWith("app_doocs_md", "stop");
    });
  });

  it("explains a failed doocs/md web editor start", async () => {
    const state = mcpConsoleState();
    state.applications![0].webEditor = {
      available: true,
      status: "failed",
      reason: "bridge_start_failed",
      commandLabel: "pnpm run start",
      lastError: "application_editor_url_unreachable",
      lastLogs: [
        "stdout: VITE v8.1.0 ready in 3451 ms",
        "stdout: Local: http://localhost:5173/md/",
        "stderr: WARN Unsupported engine: wanted node >=22.22.2",
      ],
      summary: "Application editor URL did not become reachable: http://localhost:5173/md/.",
    };
    apiMock.fetchState.mockResolvedValue(state);
    apiMock.listApplicationCapabilities.mockResolvedValue({
      applicationId: "app_doocs_md",
      capabilities: [],
    });

    useUiStore.setState({ selectedApplicationId: "app_doocs_md" });
    renderWithClient(createElement(ApplicationsInspector));

    expect(await screen.findByText("editor failed")).toBeTruthy();
    expect(screen.getByText("bridge_start_failed")).toBeTruthy();
    expect(screen.getByText("application_editor_url_unreachable")).toBeTruthy();
    expect(screen.getByText("Check the editor log, then retry Start editor after the local Vite URL is free.")).toBeTruthy();
    expect(screen.getByText("Bridge log")).toBeTruthy();
    expect(screen.getByText("stdout: Local: http://localhost:5173/md/")).toBeTruthy();
    expect(screen.getByText("Port 5173 may be occupied. Stop the existing dev server or retry after it exits.")).toBeTruthy();
    expect(screen.getByText("Confirm the local Node version satisfies the doocs/md package engine.")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Start editor/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("opens an Application result from navigation state", async () => {
    apiMock.fetchState.mockResolvedValue(mcpConsoleState());
    apiMock.listApplicationCapabilities.mockResolvedValue({
      applicationId: "app_doocs_md",
      capabilities: [],
    });

    useUiStore.setState({
      section: "applications",
      selectedApplicationId: "app_doocs_md",
      selectedApplicationResultId: "app_render_1",
    });
    renderWithClient(createElement(ApplicationsInspector));

    expect(await screen.findByRole("dialog", { name: /Application result/i })).toBeTruthy();
    await waitFor(() => {
      expect(apiMock.getApplicationResult).toHaveBeenCalledWith("app_doocs_md", "app_render_1");
    });
    expect(screen.getByText("app_render_1 · github")).toBeTruthy();
  });

  it("confirms a manual MCP candidate from the inspector", async () => {
    apiMock.fetchState.mockResolvedValue(manualMcpCandidateConsoleState());
    apiMock.listApplicationCapabilities.mockResolvedValue({
      applicationId: "app_doocs_md_manual",
      capabilities: [],
    });
    apiMock.confirmApplicationMcpCandidate
      .mockResolvedValueOnce({ approvalRequestId: "apr_mcp_confirm", status: "waiting_for_local_approval" })
      .mockResolvedValueOnce({
        application: {
          id: "app_doocs_md_manual",
          mcpAgent: { agentId: "agt_app_doocs_md_manual_mcp" },
        },
      });
    apiMock.approveApproval.mockResolvedValue({ approval: { id: "apr_mcp_confirm", status: "approved" } });

    useUiStore.setState({ selectedApplicationId: "app_doocs_md_manual" });
    renderWithClient(createElement(ApplicationsInspector));

    expect(await screen.findByText("manual confirm")).toBeTruthy();
    expect(screen.getByText("stdio_command_requires_manual_confirmation")).toBeTruthy();
    expect(screen.getByText("local_stdio_process")).toBeTruthy();
    expect(screen.getByText("read_only files / forbidden network")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: /Review MCP/i })[1]);

    expect(await screen.findByRole("dialog", { name: /Review shell/i })).toBeTruthy();
    expect(screen.getByText("Confirm this MCP candidate before it is registered as shared Application tools.")).toBeTruthy();
    const confirmButton = screen.getByRole("button", { name: /Confirm MCP/i });
    expect((confirmButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /I reviewed the MCP source/i }));
    expect((confirmButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(apiMock.approveApproval).toHaveBeenCalledWith("apr_mcp_confirm");
      expect(apiMock.confirmApplicationMcpCandidate).toHaveBeenLastCalledWith(
        "app_doocs_md_manual",
        "mcp.shell",
        { approvalRequestId: "apr_mcp_confirm" },
      );
    });
  });

  it("guides HTTP MCP candidates through live endpoint probe before confirmation", async () => {
    apiMock.fetchState.mockResolvedValue(httpMcpCandidateConsoleState());
    apiMock.listApplicationCapabilities.mockResolvedValue({
      applicationId: "app_doocs_md_http",
      capabilities: [],
    });
    apiMock.probeApplicationMcpCandidate.mockResolvedValue({
      liveProbe: {
        state: "succeeded",
        evidence: "json_rpc_initialize_tools_list",
        matchedAllowedTools: ["render_markdown"],
        missingAllowedTools: [],
      },
    });

    useUiStore.setState({ selectedApplicationId: "app_doocs_md_http" });
    renderWithClient(createElement(ApplicationsInspector));

    expect(await screen.findByText("HTTP MCP probe needed")).toBeTruthy();
    expect(screen.getAllByText("live probe needed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Probe the endpoint before confirming shared tools.").length).toBeGreaterThan(0);
    expect((screen.getByRole("button", { name: /Review MCP/i }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getAllByRole("button", { name: /Probe endpoint/i })[0]);

    await waitFor(() => {
      expect(apiMock.probeApplicationMcpCandidate).toHaveBeenCalledWith("app_doocs_md_http", "mcp.remote");
    });
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

  it("surfaces recovery operations and approves a pending recovery request", async () => {
    const writeText = mockClipboard();
    apiMock.fetchState.mockResolvedValue(recoveryConsoleState());
    apiMock.listApplicationCapabilities.mockResolvedValue({ applicationId: "app_docs", capabilities: [] });
    apiMock.approveApproval.mockResolvedValue({ approval: { id: "cdx_appr_pending", status: "approved" } });

    useUiStore.setState({ selectedApplicationId: "app_docs" });
    renderWithClient(createElement(ApplicationsInspector));

    expect(await screen.findByText("Recovery operations")).toBeTruthy();
    const recoveryOperationsCard = document.querySelector<HTMLElement>('[data-application-panel="recovery-operations"]');
    expect(recoveryOperationsCard).toBeTruthy();
    expect(within(recoveryOperationsCard as HTMLElement).getByText("Pending approval")).toBeTruthy();
    expect(within(recoveryOperationsCard as HTMLElement).getByText("Executed")).toBeTruthy();
    expect(within(recoveryOperationsCard as HTMLElement).getByText("Recovered")).toBeTruthy();
    expect(within(recoveryOperationsCard as HTMLElement).getByText("Needs attention")).toBeTruthy();
    expect(within(recoveryOperationsCard as HTMLElement).getByText("approval cdx_appr_pending")).toBeTruthy();

    fireEvent.click(within(recoveryOperationsCard as HTMLElement).getByRole("button", { name: /Copy recovery link/i }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(new URL(writeText.mock.calls[0][0] as string).searchParams.get("recovery")).toBe("app_rec_pending");

    fireEvent.click(within(recoveryOperationsCard as HTMLElement).getByRole("button", { name: /Approve recovery/i }));

    await waitFor(() => {
      expect(apiMock.approveApproval).toHaveBeenCalledWith("cdx_appr_pending");
    });
    expect(await within(recoveryOperationsCard as HTMLElement).findByText("Approved recovery request cdx_appr_pending.")).toBeTruthy();

    fireEvent.click(within(recoveryOperationsCard as HTMLElement).getByRole("button", { name: /Open recovery run/i }));
    expect(useUiStore.getState().selectedApplicationRun).toEqual({
      applicationId: "app_docs",
      routineId: "app-app_docs-maintenance",
      invocationId: "inv_failed",
    });
    expect(useUiStore.getState().selectedApplicationRecoveryId).toBe("app_rec_pending");
  });

  it("surfaces application-scoped approval requests without cross-application approvals", async () => {
    apiMock.fetchState.mockResolvedValue({
      ...recoveryConsoleState(),
      approvalRequests: [{
        id: "cdx_appr_pending",
        invocationId: "inv_failed",
        status: "pending",
        riskLevel: "high",
        riskTags: ["recovery"],
        summary: { risk: "Regenerate application orchestration", data: "Local repository metadata only" },
      }, {
        id: "cdx_appr_other",
        invocationId: "inv_other_app",
        status: "pending",
        riskLevel: "high",
      }],
    });
    apiMock.listApplicationCapabilities.mockResolvedValue({ applicationId: "app_docs", capabilities: [] });
    apiMock.approveApproval.mockResolvedValue({ approval: { id: "cdx_appr_pending", status: "approved" } });

    useUiStore.setState({ selectedApplicationId: "app_docs" });
    renderWithClient(createElement(ApplicationsInspector));

    expect(await screen.findByText("Approval queue")).toBeTruthy();
    const approvalQueue = document.querySelector<HTMLElement>('[data-application-panel="approval-queue"]');
    expect(approvalQueue).toBeTruthy();
    expect(within(approvalQueue as HTMLElement).getByText("cdx_appr_pending")).toBeTruthy();
    expect(within(approvalQueue as HTMLElement).queryByText("cdx_appr_other")).toBeNull();
    expect(within(approvalQueue as HTMLElement).getByText("Recovery app_rec_pending")).toBeTruthy();
    expect(within(approvalQueue as HTMLElement).getByText("Regenerate application orchestration · Local repository metadata only")).toBeTruthy();

    fireEvent.click(within(approvalQueue as HTMLElement).getByRole("button", { name: /^Approve$/i }));

    await waitFor(() => {
      expect(apiMock.approveApproval).toHaveBeenCalledWith("cdx_appr_pending");
    });
    expect(await within(approvalQueue as HTMLElement).findByText("Approved request cdx_appr_pending.")).toBeTruthy();
  });

  it("copies shareable application run and recovery deep links from diagnostics", async () => {
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

    useUiStore.setState({ selectedApplicationId: "app_docs", selectedApplicationRecoveryId: "app_rec_pending" });
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

    fireEvent.click(screen.getAllByRole("button", { name: /Copy recovery link/i }).at(-1) as HTMLElement);
    expect(writeText).toHaveBeenCalledTimes(2);
    const recoveryUrl = new URL(writeText.mock.calls[1][0] as string);
    expect(recoveryUrl.searchParams.get("section")).toBe("applications");
    expect(recoveryUrl.searchParams.get("application")).toBe("app_docs");
    expect(recoveryUrl.searchParams.get("routine")).toBe("app-app_docs-maintenance");
    expect(recoveryUrl.searchParams.get("run")).toBe("inv_failed");
    expect(recoveryUrl.searchParams.get("recovery")).toBe("app_rec_pending");
    expect(screen.getByText("Recovery link copied.")).toBeTruthy();
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
      source: { type: "npm", package: "ccusage", version: "20.0.16" },
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

function mcpConsoleState(): ConsoleSnapshot {
  return {
    device: {
      id: "dev_local",
      name: "Local Workstation",
      status: "online",
      platform: "win32",
      architecture: "x64",
      lastSeenAt: "2026-07-05T04:00:00.000Z",
    },
    agent: null,
    agents: [],
    currentProjectId: "prj_doocs",
    invocations: [{
      id: "inv_doocs_render",
      status: "succeeded",
      agentId: "agt_app_doocs_md_mcp",
      createdAt: "2026-07-05T04:00:00.000Z",
      result: {
        summary: "Hello from doocs.",
        touchedUserFiles: false,
      },
      options: {
        toolArguments: {
          markdown: "# Hello from doocs",
          theme: "github",
        },
        metadata: {
          providerType: "mcp",
          applicationId: "app_doocs_md",
          capability: "doocs_md.render_markdown",
          mcpToolName: "render_markdown",
        },
      },
    }],
    events: [],
    auditSummaries: [],
    applications: [{
      id: "app_doocs_md",
      name: "doocs/md",
      kind: "repository",
      status: "active",
      projectId: "prj_doocs",
      source: { type: "local", path: "C:\\apps\\doocs-md" },
      probe: {
        status: "completed",
        checkedAt: "2026-07-05T04:00:00.000Z",
        summary: "Local application path C:\\apps\\doocs-md probed.",
        capabilities: [],
        mcpServers: [{
          id: "mcp.md",
          serverName: "md",
          source: "mcp_config",
          sourcePath: ".vscode/mcp.json",
          transport: "stdio",
          toolNamespace: "doocs_md",
          allowedTools: ["render_markdown", "list_themes"],
          sharedToolNames: ["doocs_md.render_markdown", "doocs_md.list_themes"],
          status: "ready",
          confidence: "high",
          autoRegister: true,
          autoRegisterReason: "node_entrypoint_inside_application_root",
          adapterPreview: { command: "node", argCount: 1 },
        }],
        autoRegisteredMcpAgentId: "agt_app_doocs_md_mcp",
      },
      mcpAgent: {
        agentId: "agt_app_doocs_md_mcp",
        name: "doocs/md MCP",
        allowedTools: ["render_markdown", "list_themes"],
        toolNamespace: "doocs_md",
        sharedToolNames: ["doocs_md.render_markdown", "doocs_md.list_themes"],
        agentStatus: "available",
        recovery: {
          state: "registered",
          reason: "mcp_agent_autodetected_from_application_probe",
          nextAction: "The runtime can expose the discovered MCP tools after bridge-side execution policy checks.",
        },
        discovery: {
          source: "application_probe",
          candidateId: "mcp.md",
          sourcePath: ".vscode/mcp.json",
          detectedAt: "2026-07-05T04:00:00.000Z",
          autoRegistered: true,
        },
      },
      latestResult: {
        applicationId: "app_doocs_md",
        capability: "doocs_md.render_markdown",
        mcpToolName: "render_markdown",
        outputCollection: "applicationRenderResults",
        importedRecordIds: ["app_render_1"],
        importedRecordCount: 1,
        resultRef: { type: "application_render_result", id: "app_render_1", href: "/api/applications/app_doocs_md/results/app_render_1" },
        renderResult: {
          id: "app_render_1",
          applicationId: "app_doocs_md",
          invocationId: "inv_doocs_render",
          agentId: "agt_app_doocs_md_mcp",
          capability: "doocs_md.render_markdown",
          mcpToolName: "render_markdown",
          theme: "github",
          markdownHash: "a".repeat(64),
          htmlHash: "b".repeat(64),
          htmlByteLength: 28,
          htmlSummary: "Hello from doocs.",
          metadata: {
            source: "application_web_editor",
            postTitle: "Hello from doocs",
            editorUrl: "http://localhost:5173/md/?myagenttoolApplicationId=app_doocs_md",
            theme: "github",
            markdownLength: 18,
            htmlByteLength: 28,
          },
          resultRef: { type: "application_render_result", id: "app_render_1", href: "/api/applications/app_doocs_md/results/app_render_1" },
          generatedAt: "2026-07-05T04:01:00.000Z",
          createdAt: "2026-07-05T04:01:00.000Z",
          updatedAt: "2026-07-05T04:01:00.000Z",
        },
        invocationId: "inv_doocs_render",
        status: "succeeded",
        completedAt: "2026-07-05T04:01:00.000Z",
      },
      resultRetention: {
        enabled: false,
        keepLatest: 20,
        archiveAfterDays: null,
        lastRunAt: "2026-07-05T04:03:00.000Z",
        lastArchivedCount: 1,
        lastSummary: {
          applicationId: "app_doocs_md",
          status: "executed",
          reason: "manual",
          enabled: false,
          keepLatest: 20,
          archiveAfterDays: null,
          archivedCount: 1,
          archivedResultIds: ["app_render_old"],
          archivedResults: [],
          skippedPinnedCount: 1,
          executedAt: "2026-07-05T04:03:00.000Z",
        },
      },
      webEditor: {
        available: true,
        status: "not_running",
        reason: "doocs_md_start_script_detected",
        commandLabel: "pnpm run start",
      },
      createdAt: "2026-07-05T03:00:00.000Z",
      updatedAt: "2026-07-05T04:01:00.000Z",
    }],
    applicationRecoveryActions: [],
  };
}

function manualMcpCandidateConsoleState(): ConsoleSnapshot {
  return {
    device: {
      id: "dev_local",
      name: "Local Workstation",
      status: "online",
      platform: "win32",
      architecture: "x64",
      lastSeenAt: "2026-07-05T05:00:00.000Z",
    },
    agent: null,
    agents: [],
    invocations: [],
    events: [],
    auditSummaries: [],
    applications: [{
      id: "app_doocs_md_manual",
      name: "doocs/md",
      kind: "repository",
      status: "active",
      source: { type: "local", path: "C:\\apps\\doocs-md" },
      probe: {
        status: "completed",
        checkedAt: "2026-07-05T05:00:00.000Z",
        summary: "Local application path C:\\apps\\doocs-md probed.",
        capabilities: [],
        mcpServers: [{
          id: "mcp.shell",
          serverName: "shell",
          source: "mcp_config",
          sourcePath: ".vscode/mcp.json",
          transport: "stdio",
          toolNamespace: "doocs_md",
          allowedTools: ["render_markdown"],
          sharedToolNames: ["doocs_md.render_markdown"],
          status: "ready",
          confidence: "medium",
          autoRegister: false,
          autoRegisterReason: "stdio_command_requires_manual_confirmation",
          adapterPreview: { command: "cmd.exe", argCount: 1 },
          review: {
            dataBoundary: "local_stdio_process",
            requiresManualConfirmation: true,
            manualConfirmationReason: "stdio_command_requires_manual_confirmation",
            filePolicy: "read_only",
            networkPolicy: "forbidden",
            allowedToolCount: 1,
          },
        }],
      },
      mcpAgent: null,
      createdAt: "2026-07-05T05:00:00.000Z",
      updatedAt: "2026-07-05T05:00:00.000Z",
    }],
    applicationRecoveryActions: [],
  };
}

function httpMcpCandidateConsoleState(): ConsoleSnapshot {
  return {
    device: {
      id: "dev_local",
      name: "Local Workstation",
      status: "online",
      platform: "win32",
      architecture: "x64",
      lastSeenAt: "2026-07-05T05:30:00.000Z",
    },
    agent: null,
    agents: [],
    invocations: [],
    events: [],
    auditSummaries: [],
    applications: [{
      id: "app_doocs_md_http",
      name: "doocs/md HTTP",
      kind: "repository",
      status: "active",
      source: { type: "local", path: "C:\\apps\\doocs-md" },
      probe: {
        status: "completed",
        checkedAt: "2026-07-05T05:30:00.000Z",
        summary: "Local application path C:\\apps\\doocs-md probed.",
        capabilities: [],
        mcpServers: [{
          id: "mcp.remote",
          serverName: "remote",
          source: "mcp_config",
          sourcePath: ".mcp.json",
          transport: "http",
          toolNamespace: "doocs_md",
          allowedTools: ["render_markdown"],
          sharedToolNames: ["doocs_md.render_markdown"],
          status: "ready",
          confidence: "medium",
          autoRegister: false,
          autoRegisterReason: "http_transport_requires_live_probe",
          adapterPreview: { url: "https://mcp.example.test/rpc" },
          review: {
            dataBoundary: "bridge_to_http_endpoint",
            requiresManualConfirmation: true,
            manualConfirmationReason: "http_transport_requires_live_probe",
            filePolicy: "read_only",
            networkPolicy: "restricted",
            allowedToolCount: 1,
            endpointOrigin: "https://mcp.example.test",
            endpointHost: "mcp.example.test",
            endpointProtocol: "https",
            liveProbe: {
              state: "not_run",
              requiredBeforeExecution: true,
              checkedAt: null,
              evidence: "not_recorded",
              endpointUrl: "https://mcp.example.test/rpc",
              endpointOrigin: "https://mcp.example.test",
              endpointHost: "mcp.example.test",
              endpointProtocol: "https",
              networkPolicy: "restricted",
              nextAction: "Probe the endpoint before confirming shared tools.",
            },
          },
        }],
      },
      mcpAgent: null,
      createdAt: "2026-07-05T05:30:00.000Z",
      updatedAt: "2026-07-05T05:30:00.000Z",
    }],
    applicationRenderResults: [{
      id: "app_render_1",
      applicationId: "app_doocs_md",
      invocationId: "inv_doocs_render",
      agentId: "agt_app_doocs_md_mcp",
      capability: "doocs_md.render_markdown",
      mcpToolName: "render_markdown",
      theme: "github",
      markdownHash: "a".repeat(64),
      htmlHash: "b".repeat(64),
      htmlByteLength: 28,
      htmlSummary: "Hello from doocs.",
      metadata: { theme: "github" },
      resultRef: { type: "application_render_result", id: "app_render_1", href: "/api/applications/app_doocs_md/results/app_render_1" },
      generatedAt: "2026-07-05T04:01:00.000Z",
      createdAt: "2026-07-05T04:01:00.000Z",
      updatedAt: "2026-07-05T04:01:00.000Z",
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
