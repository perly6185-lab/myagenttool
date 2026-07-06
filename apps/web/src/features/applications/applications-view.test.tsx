import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationsView } from "@/features/applications/applications-view";
import { useUiStore } from "@/store/ui-store";
import type { ConsoleSnapshot } from "@/lib/console-state";

const apiMock = vi.hoisted(() => ({
  fetchState: vi.fn(),
  registerApplication: vi.fn(),
}));

vi.mock("@/lib/api-client", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client")),
  fetchState: apiMock.fetchState,
  api: {
    registerApplication: apiMock.registerApplication,
  },
}));

beforeEach(() => {
  apiMock.fetchState.mockResolvedValue(consoleState());
  useUiStore.setState({
    section: "applications",
    selectedApplicationId: null,
    selectedApplicationRun: null,
    selectedApplicationEventLevel: "all",
    selectedApplicationAutomationId: null,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useUiStore.setState({
    section: "dashboard",
    selectedApplicationId: null,
    selectedApplicationRun: null,
    selectedApplicationEventLevel: "all",
    selectedApplicationAutomationId: null,
  });
});

describe("ApplicationsView timeline routing", () => {
  it("selects an application timeline level from attention shortcuts", async () => {
    renderWithClient(createElement(ApplicationsView));

    fireEvent.click(await screen.findByRole("button", { name: /View errors/i }));

    expect(useUiStore.getState().selectedApplicationId).toBe("app_failed");
    expect(useUiStore.getState().selectedApplicationEventLevel).toBe("error");

    fireEvent.click(screen.getByText("Docs Ready"));

    expect(useUiStore.getState().selectedApplicationId).toBe("app_ready");
    expect(useUiStore.getState().selectedApplicationEventLevel).toBe("all");
  });
});

describe("ApplicationsView recovery summary", () => {
  it("shows the latest recovery action and opens its diagnostics run", async () => {
    renderWithClient(createElement(ApplicationsView));

    expect((await screen.findAllByText("Pending")).length).toBeGreaterThan(0);
    expect(screen.getByText("Regenerate orchestration")).toBeTruthy();
    expect(screen.getByText("Resolve the linked approval request before this recovery can execute.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /View recovery/i }));

    expect(useUiStore.getState().selectedApplicationId).toBe("app_failed");
    expect(useUiStore.getState().selectedApplicationRun).toEqual({
      applicationId: "app_failed",
      routineId: "routine_failed",
      invocationId: "inv_failed",
    });
    expect(useUiStore.getState().selectedApplicationEventLevel).toBe("all");
  });
});

describe("ApplicationsView automation schedule attention", () => {
  it("shows application schedule health and opens the selected application schedules", async () => {
    renderWithClient(createElement(ApplicationsView));

    expect(await screen.findByText("1 failing schedule")).toBeTruthy();
    expect(screen.getByText("2 attention")).toBeTruthy();
    expect(screen.getByText("Wrapper command exited 1.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Inspect failing schedule/i }));

    expect(useUiStore.getState().selectedApplicationId).toBe("app_ready");
    expect(useUiStore.getState().selectedApplicationRun).toBeNull();
    expect(useUiStore.getState().selectedApplicationEventLevel).toBe("all");
    expect(useUiStore.getState().selectedApplicationAutomationId).toBe("atm_ready_daily");
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
      lastSeenAt: "2026-07-06T00:00:00.000Z",
    },
    agent: null,
    agents: [],
    invocations: [],
    events: [],
    auditSummaries: [],
    applications: [{
      id: "app_failed",
      name: "Docs Failed",
      kind: "repository",
      source: { type: "local", path: "/apps/failed" },
      status: "failed",
      lifecycle: { error: "Probe failed." },
      createdAt: "2026-07-06T00:00:00.000Z",
      updatedAt: "2026-07-06T03:00:00.000Z",
      healthSummary: {
        applicationId: "app_failed",
        eventCounts: { error: 1, warning: 0, info: 0, other: 0 },
        eventCount: 1,
        lastEventAt: "2026-07-06T03:05:00.000Z",
        latestAttentionEvent: null,
        latestRecoveryAction: {
          id: "rec_failed_pending",
          applicationId: "app_failed",
          routineId: "routine_failed",
          invocationId: "inv_failed",
          actionType: "regenerate_orchestration",
          status: "approval_pending",
          recoveryCategory: "validation_failed",
          reason: "Routine validation failed.",
          requiresApproval: true,
          approvalRequestId: "appr_failed",
          outcome: {
            state: "pending",
            reason: "approval_pending",
            severity: "info",
            summary: "Recovery is pending approval.",
            nextStep: "Resolve the linked approval request before this recovery can execute.",
          },
          explanation: {
            selectedAction: "regenerate_orchestration",
            state: "approval_pending",
            reason: "approval_pending",
            nextStep: "Resolve the linked approval request before this recovery can execute.",
          },
          createdAt: "2026-07-06T03:05:00.000Z",
          updatedAt: "2026-07-06T03:06:00.000Z",
        },
      },
    }, {
      id: "app_ready",
      name: "Docs Ready",
      kind: "repository",
      source: { type: "local", path: "/apps/ready" },
      status: "active",
      probe: { capabilities: [] },
      orchestrationIds: ["routine"],
      healthSummary: {
        applicationId: "app_ready",
        eventCounts: { error: 0, warning: 0, info: 0, other: 0 },
        eventCount: 0,
        automationCounts: { failing: 1, waitingForApproval: 0, paused: 0, attention: 1 },
        latestAutomationAttention: {
          automationId: "atm_ready_daily",
          name: "Docs daily",
          status: "failing",
          failureStreak: 1,
          latestInvocationId: "inv_ready_daily",
          lastErrorSummary: "Wrapper command exited 1.",
          nextAction: "Open the latest invocation and review the audit summary before retrying.",
        },
      },
      createdAt: "2026-07-06T00:00:00.000Z",
      updatedAt: "2026-07-06T02:00:00.000Z",
    }],
    applicationRecoveryActions: [],
  };
}
