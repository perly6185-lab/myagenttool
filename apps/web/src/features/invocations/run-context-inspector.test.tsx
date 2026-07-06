import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunContextInspector } from "@/features/invocations/run-context-inspector";
import { useUiStore } from "@/store/ui-store";
import type { ConsoleSnapshot } from "@/lib/console-state";

const apiMock = vi.hoisted(() => ({
  fetchState: vi.fn(),
  troubleshoot: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  fetchState: apiMock.fetchState,
  api: {
    troubleshoot: apiMock.troubleshoot,
    approveApproval: vi.fn(),
    denyApproval: vi.fn(),
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

describe("RunContextInspector troubleshooting report links", () => {
  it("opens and copies troubleshooting report Web links from the inspector surface", async () => {
    const writeText = mockClipboard();
    window.history.replaceState(null, "", "/console?keep=yes#inspector");
    apiMock.fetchState.mockResolvedValue(consoleState());

    useUiStore.setState({ section: "invocations", selectedInvocationId: "inv_failed" });
    renderWithClient(createElement(RunContextInspector));

    expect(await screen.findByText("Troubleshooting inv_failed")).toBeTruthy();
    expect(screen.getByText("Report links")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Open troubleshooter invocation$/i }));
    expect(useUiStore.getState().section).toBe("invocations");
    expect(useUiStore.getState().selectedInvocationId).toBe("inv_report");

    useUiStore.setState({ section: "invocations", selectedInvocationId: "inv_failed" });
    await waitFor(() => expect(screen.getByText("Report links")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /^Open application run$/i }));
    expect(useUiStore.getState().section).toBe("applications");
    expect(useUiStore.getState().selectedApplicationId).toBe("app_docs");
    expect(useUiStore.getState().selectedApplicationRun).toEqual({
      applicationId: "app_docs",
      routineId: "routine_docs_smoke",
      invocationId: "inv_failed",
    });
    expect(useUiStore.getState().selectedApplicationAutomationId).toBe("atm_docs_daily");

    fireEvent.click(screen.getByRole("button", { name: /^Copy Open application run$/i }));
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = new URL(writeText.mock.calls[0][0] as string);
    expect(copied.pathname).toBe("/console");
    expect(copied.hash).toBe("#inspector");
    expect(copied.searchParams.get("keep")).toBe("yes");
    expect(copied.searchParams.get("section")).toBe("applications");
    expect(copied.searchParams.get("application")).toBe("app_docs");
    expect(copied.searchParams.get("routine")).toBe("routine_docs_smoke");
    expect(copied.searchParams.get("run")).toBe("inv_failed");
    expect(copied.searchParams.get("automation")).toBe("atm_docs_daily");
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
    serverTime: "2026-07-05T12:00:00.000Z",
    device: {
      id: "dev_local",
      name: "Local bridge",
      status: "online",
      platform: "win32",
      architecture: "x64",
      lastSeenAt: "2026-07-05T12:00:00.000Z",
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
      result: { summary: "Routine failed." },
      options: { metadata: {} },
    }, {
      id: "inv_report",
      status: "succeeded",
      agentId: "agt_platform_troubleshooter",
      projectId: "proj_docs",
      result: { summary: "Report generated." },
      options: { metadata: { targetInvocationId: "inv_failed" } },
    }],
    events: [],
    auditSummaries: [],
    approvalRequests: [],
    troubleshootingReports: [{
      id: "trb_1",
      invocationId: "inv_failed",
      troubleshooterInvocationId: "inv_report",
      summary: "Troubleshooter reviewed inv_failed.",
      bridgeState: "online",
      logSummary: "No logs.",
      suggestedFixes: ["Retry after fixing the routine."],
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
          query: "?section=applications&application=app_docs&routine=routine_docs_smoke&run=inv_failed&automation=atm_docs_daily",
          target: {
            section: "applications",
            application: "app_docs",
            routine: "routine_docs_smoke",
            run: "inv_failed",
            automation: "atm_docs_daily",
          },
        },
      },
    }],
  } as ConsoleSnapshot;
}
