import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationsView } from "@/features/applications/applications-view";
import { useUiStore } from "@/store/ui-store";
import type { ConsoleSnapshot } from "@/lib/console-state";

const apiMock = vi.hoisted(() => ({
  fetchState: vi.fn(),
  registerApplication: vi.fn(),
  applicationLifecycle: vi.fn(),
}));

vi.mock("@/lib/api-client", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client")),
  fetchState: apiMock.fetchState,
  api: {
    registerApplication: apiMock.registerApplication,
    applicationLifecycle: apiMock.applicationLifecycle,
  },
}));

beforeEach(() => {
  apiMock.fetchState.mockResolvedValue(consoleState());
  apiMock.applicationLifecycle.mockResolvedValue({ application: { id: "app_doocs_md" } });
  useUiStore.setState({
    section: "applications",
    selectedApplicationId: null,
    selectedApplicationRun: null,
    selectedApplicationRecoveryId: null,
    selectedApplicationEventLevel: "all",
    selectedApplicationAutomationId: null,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
  useUiStore.setState({
    section: "dashboard",
    selectedApplicationId: null,
    selectedApplicationRun: null,
    selectedApplicationRecoveryId: null,
    selectedApplicationEventLevel: "all",
    selectedApplicationAutomationId: null,
  });
});

describe("ApplicationsView timeline routing", () => {
  it("restores selected application from the URL after applications load", async () => {
    window.history.replaceState(null, "", "/?section=applications&application=app_ready");

    renderWithClient(createElement(ApplicationsView));

    await screen.findByText("Docs Ready");
    await waitFor(() => {
      expect(useUiStore.getState().selectedApplicationId).toBe("app_ready");
    });
  });

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

describe("ApplicationsView ccusage registration", () => {
  it("shows built-in and custom integration entry points", async () => {
    renderWithClient(createElement(ApplicationsView));

    expect(await screen.findByText("Built-in Applications")).toBeTruthy();
    expect(screen.getByText("Reviewed first")).toBeTruthy();
    expect(screen.getByText("doocs/md MCP")).toBeTruthy();
    expect(screen.getByText("Custom integration")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Start advanced registration" }));

    expect(screen.getByText("Source type")).toBeTruthy();
    expect(screen.getByText("Advanced descriptors")).toBeTruthy();
  });

  it("registers the canonical ccusage application from the built-in applications section", async () => {
    apiMock.registerApplication.mockResolvedValue({
      application: { id: "app_ccusage" },
      capabilities: [],
    });
    renderWithClient(createElement(ApplicationsView));

    fireEvent.click(await screen.findByRole("button", { name: "Register built-in ccusage" }));

    await waitFor(() => expect(apiMock.registerApplication).toHaveBeenCalledWith(expect.objectContaining({
      id: "app_ccusage",
      name: "ccusage",
      autoOnline: false,
      source: expect.objectContaining({
        type: "npm",
        package: "ccusage",
        version: "20.0.16",
        wrapper: expect.objectContaining({
          mode: "installed-wrapper",
          packageManager: "npm",
          commands: expect.arrayContaining([
            expect.objectContaining({
              id: "daily",
              command: "ccusage",
              args: ["daily", "--json", "--offline"],
              compatibilityFacade: expect.objectContaining({ name: "ccusage.report" }),
              outputCollection: "importedUsageEstimates",
            }),
            expect.objectContaining({
              id: "session",
              requiresApproval: true,
            }),
          ]),
        }),
      }),
    })));
    expect(useUiStore.getState().selectedApplicationId).toBe("app_ccusage");
  });

  it("registers and probes the canonical doocs/md application from the built-in applications section", async () => {
    apiMock.registerApplication.mockResolvedValue({
      application: { id: "app_doocs_md" },
      capabilities: [],
    });
    renderWithClient(createElement(ApplicationsView));

    fireEvent.click(await screen.findByRole("button", { name: "Register doocs/md" }));

    await waitFor(() => expect(apiMock.registerApplication).toHaveBeenCalledWith(expect.objectContaining({
      id: "app_doocs_md",
      name: "doocs/md",
      source: {
        type: "local",
        path: "doocs-md",
      },
      integrationBrief: expect.objectContaining({
        intent: expect.stringContaining("doocs/md MCP"),
        sourceType: "local",
        fixedCommands: expect.arrayContaining(["render_markdown", "list_themes", "pnpm run start"]),
        smokeTests: expect.arrayContaining(["pnpm smoke:doocs-md-editor"]),
      }),
    })));
    await waitFor(() => {
      expect(apiMock.applicationLifecycle).toHaveBeenCalledWith("app_doocs_md", "probe");
    });
    expect(useUiStore.getState().selectedApplicationId).toBe("app_doocs_md");
  });

  it("opens ccusage when it is already registered", async () => {
    apiMock.fetchState.mockResolvedValue({
      ...consoleState(),
      applications: [
        ...consoleState().applications!,
        {
          id: "app_ccusage",
          name: "ccusage",
          kind: "npm_package",
          source: { type: "npm", package: "ccusage", version: "20.0.16" },
          status: "registered",
          createdAt: "2026-07-06T00:00:00.000Z",
          updatedAt: "2026-07-06T00:00:00.000Z",
        },
      ],
    });
    renderWithClient(createElement(ApplicationsView));

    fireEvent.click(await screen.findByRole("button", { name: "Open ccusage" }));

    expect(apiMock.registerApplication).not.toHaveBeenCalled();
    expect(useUiStore.getState().selectedApplicationId).toBe("app_ccusage");
  });

  it("opens doocs/md when it is already registered", async () => {
    apiMock.fetchState.mockResolvedValue({
      ...consoleState(),
      applications: [
        ...consoleState().applications!,
        {
          id: "app_doocs_md",
          name: "doocs/md",
          kind: "repository",
          source: { type: "local", path: "D:\\github\\perly6185-lab\\myagenttool\\doocs-md" },
          status: "active",
          createdAt: "2026-07-06T00:00:00.000Z",
          updatedAt: "2026-07-06T00:00:00.000Z",
        },
      ],
    });
    renderWithClient(createElement(ApplicationsView));

    fireEvent.click(await screen.findByRole("button", { name: "Open doocs/md" }));

    expect(apiMock.registerApplication).not.toHaveBeenCalled();
    expect(apiMock.applicationLifecycle).not.toHaveBeenCalled();
    expect(useUiStore.getState().selectedApplicationId).toBe("app_doocs_md");
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
    expect(screen.getByText("3 attention")).toBeTruthy();
    expect(screen.getByText("Wrapper command exited 1.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Inspect failing schedule/i }));

    expect(useUiStore.getState().selectedApplicationId).toBe("app_ready");
    expect(useUiStore.getState().selectedApplicationRun).toBeNull();
    expect(useUiStore.getState().selectedApplicationEventLevel).toBe("all");
    expect(useUiStore.getState().selectedApplicationAutomationId).toBe("atm_ready_daily");
  });
});

describe("ApplicationsView mixed fleet search", () => {
  it("summarizes and filters the Application fleet by source, MCP transport, and probe state", async () => {
    apiMock.fetchState.mockResolvedValue(fleetConsoleState());
    renderWithClient(createElement(ApplicationsView));

    expect(await screen.findByText("Fleet overview")).toBeTruthy();
    expect(await screen.findByText("npm Wrapper")).toBeTruthy();
    expect(screen.getByRole("button", { name: /npm wrappers 1/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /stdio MCP 1/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /HTTP MCP 1/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Manual manifests 1/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Blocked probes 1/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Blocked probes 1/i }));

    expect(await screen.findByText("HTTP MCP Blocked")).toBeTruthy();
    expect(screen.queryByText("Docs Ready")).toBeNull();
    expect(screen.queryByText("npm Wrapper")).toBeNull();
  });

  it("matches HTTP MCP live-probe recovery issues from the application list", async () => {
    renderWithClient(createElement(ApplicationsView));

    fireEvent.change(await screen.findByPlaceholderText("Name, id, source, path"), {
      target: { value: "probe blocked" },
    });

    expect(await screen.findByText("HTTP MCP Blocked")).toBeTruthy();
    expect(screen.getByText("HTTP MCP probe blocked")).toBeTruthy();
    expect(screen.queryByText("Docs Ready")).toBeNull();
  });

  it("clears stale run, event, and automation selections when switching applications", async () => {
    useUiStore.setState({
      selectedApplicationId: "app_ready",
      selectedApplicationRun: {
        applicationId: "app_ready",
        routineId: "routine_ready",
        invocationId: "inv_ready_daily",
      },
      selectedApplicationEventLevel: "error",
      selectedApplicationAutomationId: "atm_ready_daily",
    });
    renderWithClient(createElement(ApplicationsView));

    fireEvent.click(await screen.findByText("HTTP MCP Blocked"));

    expect(useUiStore.getState().selectedApplicationId).toBe("app_http_blocked");
    expect(useUiStore.getState().selectedApplicationRun).toBeNull();
    expect(useUiStore.getState().selectedApplicationRecoveryId).toBeNull();
    expect(useUiStore.getState().selectedApplicationEventLevel).toBe("all");
    expect(useUiStore.getState().selectedApplicationAutomationId).toBeNull();
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

function fleetConsoleState(): ConsoleSnapshot {
  const state = consoleState();
  return {
    ...state,
    applications: [
      ...(state.applications ?? []),
      {
        id: "app_npm_wrapper",
        name: "npm Wrapper",
        kind: "tool",
        source: { type: "npm", package: "demo-wrapper", version: "1.0.0" },
        status: "active",
        createdAt: "2026-07-06T00:00:00.000Z",
        updatedAt: "2026-07-06T04:00:00.000Z",
      },
      {
        id: "app_stdio_mcp",
        name: "stdio MCP",
        kind: "repository",
        source: { type: "local", path: "/apps/stdio-mcp" },
        status: "active",
        probe: {
          mcpServers: [{
            id: "mcp.stdio",
            serverName: "stdio",
            transport: "stdio",
            status: "ready",
          }],
        },
        createdAt: "2026-07-06T00:00:00.000Z",
        updatedAt: "2026-07-06T04:00:00.000Z",
      },
      {
        id: "app_manual",
        name: "Manual Manifest",
        kind: "manual",
        source: { type: "manual", uri: "manual://demo", manifest: { name: "demo" } },
        status: "registered",
        createdAt: "2026-07-06T00:00:00.000Z",
        updatedAt: "2026-07-06T04:00:00.000Z",
      },
    ],
  };
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
    }, {
      id: "app_http_blocked",
      name: "HTTP MCP Blocked",
      kind: "repository",
      source: { type: "local", path: "/apps/http-blocked" },
      status: "active",
      probe: {
        capabilities: [],
        mcpServers: [{
          id: "mcp.remote",
          serverName: "remote",
          transport: "http",
          status: "ready",
          autoRegister: false,
          review: {
            liveProbe: {
              state: "blocked",
              requiredBeforeExecution: true,
              evidence: "server_network_policy_check",
              nextAction: "Use a public HTTP(S) endpoint for server-side live probe evidence.",
            },
          },
        }],
      },
      orchestrationIds: ["routine"],
      healthSummary: {
        applicationId: "app_http_blocked",
        eventCounts: { error: 0, warning: 0, info: 0, other: 0 },
        eventCount: 0,
      },
      createdAt: "2026-07-06T00:00:00.000Z",
      updatedAt: "2026-07-06T01:00:00.000Z",
    }],
    applicationRecoveryActions: [],
  };
}
