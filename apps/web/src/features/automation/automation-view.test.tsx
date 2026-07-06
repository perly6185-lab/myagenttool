import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutomationView } from "@/features/automation/automation-view";
import { useUiStore } from "@/store/ui-store";
import type { ConsoleSnapshot } from "@/lib/console-state";

const apiMock = vi.hoisted(() => ({
  fetchState: vi.fn(),
  createAutomation: vi.fn(),
  runAutomation: vi.fn(),
  updateAutomation: vi.fn(),
  deleteAutomation: vi.fn(),
}));

vi.mock("@/lib/api-client", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client")),
  fetchState: apiMock.fetchState,
  api: {
    createAutomation: apiMock.createAutomation,
    runAutomation: apiMock.runAutomation,
    updateAutomation: apiMock.updateAutomation,
    deleteAutomation: apiMock.deleteAutomation,
  },
}));

beforeEach(() => {
  apiMock.fetchState.mockResolvedValue(consoleState());
  useUiStore.setState({ section: "automation", selectedInvocationId: null });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useUiStore.setState({ section: "dashboard", selectedInvocationId: null });
});

describe("AutomationView health filters", () => {
  it("filters automations by server health summary and shows application capability targets", async () => {
    renderWithClient(createElement(AutomationView));

    expect(await screen.findByText("Failing 1")).toBeTruthy();
    expect(screen.getByText("Approval 1")).toBeTruthy();
    expect(screen.getByText("Healthy 1")).toBeTruthy();
    expect(screen.getByText("wrapper.daily")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Failing 1" }));

    expect(screen.getAllByText("ccusage daily").length).toBeGreaterThan(0);
    expect(screen.queryByText("Docs audit")).toBeNull();
    expect(screen.queryByText("Release check")).toBeNull();
    expect(screen.getByText("Wrapper command exited 1.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Pause schedule/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /View latest run/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Pause schedule/i }));
    expect(apiMock.updateAutomation).toHaveBeenCalledWith("atm_failed", { enabled: false });

    fireEvent.click(screen.getByRole("button", { name: /View latest run/i }));
    expect(useUiStore.getState().section).toBe("invocations");
    expect(useUiStore.getState().selectedInvocationId).toBe("inv_failed");
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

function consoleState(): ConsoleSnapshot {
  return {
    device: {
      id: "dev_local",
      name: "Local Workstation",
      status: "online",
      platform: "win32",
      architecture: "x64",
      lastSeenAt: "2026-07-07T00:00:00.000Z",
    },
    agent: null,
    agents: [{ id: "agt_codex", name: "Codex", status: "available" }],
    projects: [{ id: "prj_myagenttool", name: "MyAgentTool", color: "blue", ownerTeamId: "team_local", budgetPoolId: null, defaultAgentId: null, status: "active", isolation: "shared", createdAt: "2026-07-07T00:00:00.000Z" }],
    invocations: [],
    events: [],
    auditSummaries: [],
    applications: [],
    automations: [{
      id: "atm_failed",
      name: "ccusage daily",
      enabled: true,
      kind: "application_capability",
      projectId: "prj_myagenttool",
      schedule: { kind: "daily", time: "09:00", label: "Daily at 09:00" },
      nextRunAt: "2026-07-08T09:00:00.000Z",
      agentId: "agt_codex",
      prompt: "Run application capability app.app_ccusage.wrapper.daily.",
      lastRunAt: "2026-07-07T09:00:00.000Z",
      runCount: 2,
      target: {
        type: "application_capability",
        applicationId: "app_ccusage",
        capabilityName: "app.app_ccusage.wrapper.daily",
        input: { source: "codex" },
      },
      healthSummary: {
        automationId: "atm_failed",
        status: "failing",
        failureStreak: 2,
        runCount: 2,
        lastErrorSummary: "Wrapper command exited 1.",
        latestRun: { invocationId: "inv_failed", status: "failed", scheduled: true, errorSummary: "Wrapper command exited 1." },
        nextAction: "Pause the schedule if it is noisy, then inspect the latest invocation before retrying.",
      },
    }, {
      id: "atm_approval",
      name: "Docs audit",
      enabled: true,
      kind: "prompt",
      projectId: "prj_myagenttool",
      branch: "main",
      schedule: { kind: "weekdays", time: "09:00", label: "Weekdays at 09:00" },
      nextRunAt: "2026-07-08T09:00:00.000Z",
      agentId: "agt_codex",
      prompt: "Audit docs.",
      lastRunAt: null,
      runCount: 0,
      healthSummary: {
        automationId: "atm_approval",
        status: "waiting_for_approval",
        failureStreak: 0,
        runCount: 1,
        latestRun: { invocationId: "inv_approval", status: "waiting_for_local_approval", scheduled: true },
        nextAction: "Resolve the linked approval request before the automation can continue.",
      },
    }, {
      id: "atm_healthy",
      name: "Release check",
      enabled: true,
      kind: "prompt",
      projectId: "prj_myagenttool",
      branch: "main",
      schedule: { kind: "daily", time: "18:00", label: "Daily at 18:00" },
      nextRunAt: "2026-07-08T18:00:00.000Z",
      agentId: "agt_codex",
      prompt: "Check release.",
      lastRunAt: "2026-07-07T18:00:00.000Z",
      runCount: 1,
      healthSummary: {
        automationId: "atm_healthy",
        status: "healthy",
        failureStreak: 0,
        runCount: 1,
        latestRun: { invocationId: "inv_healthy", status: "succeeded", scheduled: true, resultSummary: "OK" },
        nextAction: "No action needed; inspect the latest run if you need output details.",
      },
    }],
    applicationRecoveryActions: [],
  };
}
