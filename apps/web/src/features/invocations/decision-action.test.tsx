import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DecisionAction } from "@/features/invocations/decision-action";
import type {
  CodexApprovalBrokerRequest,
  ConsoleSnapshot,
  InvocationEventSnapshot,
} from "@/lib/console-state";

const apiMock = vi.hoisted(() => ({
  fetchState: vi.fn(),
  approveCodexApproval: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  fetchState: apiMock.fetchState,
  api: {
    approveCodexApproval: apiMock.approveCodexApproval,
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DecisionAction timed-out Codex approval recovery", () => {
  it("offers a late approval and sends it through the broker", async () => {
    apiMock.fetchState.mockResolvedValue(snapshot(request()));
    apiMock.approveCodexApproval.mockResolvedValue({});
    renderWithClient(<DecisionAction event={approvalEvent()} />);

    const button = await screen.findByRole("button", { name: "Approve and resume" });
    fireEvent.click(button);
    await waitFor(() => expect(apiMock.approveCodexApproval).toHaveBeenCalledWith("cdx_1"));
  });

  it("shows waiting and resumed states without offering a duplicate action", async () => {
    apiMock.fetchState.mockResolvedValue(snapshot(request({
      lateApprovalRecovery: { status: "waiting_for_terminal", autoRunId: "aur_1" },
    })));
    const view = renderWithClient(<DecisionAction event={approvalEvent()} />);
    expect(await screen.findByText(/waiting for the expired run to settle/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve and resume" })).toBeNull();

    view.unmount();
    apiMock.fetchState.mockResolvedValue(snapshot(request({
      lateApprovalRecovery: {
        status: "resumed",
        autoRunId: "aur_1",
        resumedInvocationId: "inv_2",
      },
    })));
    renderWithClient(<DecisionAction event={approvalEvent()} />);
    expect(await screen.findByText(/task resumed on its existing worktree/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve and resume" })).toBeNull();
  });

  it("surfaces a recovery API failure inline", async () => {
    apiMock.fetchState.mockResolvedValue(snapshot(request()));
    apiMock.approveCodexApproval.mockRejectedValue(new Error("retry conflict"));
    renderWithClient(<DecisionAction event={approvalEvent()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Approve and resume" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Recovery failed: retry conflict");
  });
});

function request(overrides: Partial<CodexApprovalBrokerRequest> = {}): CodexApprovalBrokerRequest {
  return {
    id: "cdx_1",
    invocationId: "inv_1",
    status: "timed_out",
    toolName: "Bash",
    ...overrides,
  };
}

function approvalEvent(): InvocationEventSnapshot {
  return {
    id: "evt_1",
    invocationId: "inv_1",
    type: "codex_approval_requested",
    level: "warn",
    message: "Approval requested.",
    createdAt: "2026-07-26T00:00:00.000Z",
    data: { approvalBrokerRequestId: "cdx_1" },
  };
}

function snapshot(approvalRequest: CodexApprovalBrokerRequest): ConsoleSnapshot {
  return {
    namespace: "test",
    protocolVersion: "0.0.0",
    device: {
      id: "dev_1",
      name: "Local",
      status: "online",
      platform: "win32",
      architecture: "x64",
      lastSeenAt: "2026-07-26T00:00:00.000Z",
    },
    agent: null,
    agents: [],
    projects: [],
    worktrees: [],
    currentProjectId: null,
    invocations: [],
    events: [],
    auditSummaries: [],
    approvalRequests: [],
    codexApprovalBrokerRequests: [approvalRequest],
  } as ConsoleSnapshot;
}

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
