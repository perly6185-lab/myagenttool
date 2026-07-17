import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorktreeView } from "@/features/projects/worktree-view";
import { useUiStore } from "@/store/ui-store";
import type { ConsoleSnapshot, WorktreeSnapshot } from "@/lib/console-state";

const apiMock = vi.hoisted(() => ({
  fetchState: vi.fn(),
  listInvocationEvents: vi.fn(),
  listWorktreeFiles: vi.fn(),
  readWorktreeFile: vi.fn(),
  createInvocation: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  fetchState: apiMock.fetchState,
  api: {
    listInvocationEvents: apiMock.listInvocationEvents,
    listWorktreeFiles: apiMock.listWorktreeFiles,
    readWorktreeFile: apiMock.readWorktreeFile,
    createInvocation: apiMock.createInvocation,
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
  useUiStore.setState({
    section: "projects",
    selectedInvocationId: null,
    selectedWorktreeId: "wt_docs",
  });
});

describe("WorktreeView session history", () => {
  it("defaults to the latest run and switches output when an older session is selected", async () => {
    apiMock.fetchState.mockResolvedValue(consoleState());
    apiMock.listWorktreeFiles.mockResolvedValue({
      tree: [{ name: "README.md", path: "README.md", dir: false }],
    });
    apiMock.readWorktreeFile.mockResolvedValue({ content: "README body" });
    apiMock.listInvocationEvents.mockImplementation((id: string) =>
      Promise.resolve({
        invocationId: id,
        events: [{
          id: `evt_${id}`,
          invocationId: id,
          type: "log",
          level: "info",
          createdAt: id === "inv_new" ? "2026-07-14T09:05:00.000Z" : "2026-07-14T08:05:00.000Z",
          message: id === "inv_new" ? "new session output" : "old session output",
        }],
        nextCursor: null,
        hasMore: false,
        retentionTruncated: false,
      }),
    );

    renderWorktree();

    expect(await screen.findByText("inv_new · succeeded")).toBeTruthy();
    expect(await screen.findByText("new session output")).toBeTruthy();
    expect(useUiStore.getState().selectedInvocationId).toBe("inv_new");

    // A history selection also brings the main pane back from a file tab.
    fireEvent.click(await screen.findByRole("button", { name: "README.md" }));
    expect(await screen.findByText("README body")).toBeTruthy();
    expect(screen.queryByText("Session output")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Sessions" }));
    fireEvent.click(screen.getByRole("button", { name: /inv_old/i }));

    expect(await screen.findByText("inv_old · failed")).toBeTruthy();
    expect(await screen.findByText("old session output")).toBeTruthy();
    expect(screen.getByText("Session output")).toBeTruthy();
    expect(useUiStore.getState().selectedInvocationId).toBe("inv_old");
    expect(screen.getByRole("button", { name: /inv_old/i }).getAttribute("aria-pressed")).toBe("true");
    expect(apiMock.listInvocationEvents).toHaveBeenCalledWith("inv_old", {
      limit: 100,
      before: undefined,
    });
  }, 15_000);

  it("keeps run admission tied to the latest run while an older completed run is selected", async () => {
    const state = consoleState();
    state.invocations = state.invocations.map((invocation) =>
      invocation.id === "inv_new" ? { ...invocation, status: "running" } : invocation,
    );
    apiMock.fetchState.mockResolvedValue(state);
    apiMock.listWorktreeFiles.mockResolvedValue({ tree: [] });
    apiMock.listInvocationEvents.mockResolvedValue({
      invocationId: "inv_old",
      events: [],
      nextCursor: null,
      hasMore: false,
      retentionTruncated: false,
    });
    useUiStore.setState({ selectedInvocationId: "inv_old" });

    renderWorktree();

    expect(await screen.findByText("inv_old · failed")).toBeTruthy();
    const runButton = screen.getByRole("button", { name: "Running…" }) as HTMLButtonElement;
    expect(runButton.disabled).toBe(true);
  });

  it("selects a user-created run before the console-state refresh catches up", async () => {
    apiMock.fetchState.mockResolvedValue(consoleState());
    apiMock.listWorktreeFiles.mockResolvedValue({ tree: [] });
    apiMock.createInvocation.mockResolvedValue({
      invocation: {
        id: "inv_created",
        status: "queued",
        agentId: "agt_codex",
        projectId: "proj_docs",
        worktreeId: "wt_docs",
        createdAt: "2026-07-14T09:11:00.000Z",
        input: { task: "New task" },
      },
    });
    apiMock.listInvocationEvents.mockImplementation((id: string) =>
      Promise.resolve({
        invocationId: id,
        events: [],
        nextCursor: null,
        hasMore: false,
        retentionTruncated: false,
      }),
    );
    useUiStore.setState({ selectedInvocationId: "inv_old" });

    renderWorktree();
    expect(await screen.findByText("inv_old · failed")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Run in this worktree" }));

    expect(await screen.findByText("inv_created · queued")).toBeTruthy();
    expect(useUiStore.getState().selectedInvocationId).toBe("inv_created");
    expect((screen.getByRole("button", { name: "Running…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(apiMock.listInvocationEvents).toHaveBeenCalledWith("inv_created", {
      limit: 100,
      before: undefined,
    });
  });
});

function renderWorktree() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchInterval: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <WorktreeView worktree={worktree()} />
    </QueryClientProvider>,
  );
}

function worktree(): WorktreeSnapshot {
  return {
    id: "wt_docs",
    projectId: "proj_docs",
    targetId: "target_docs",
    branch: "codex/session-history",
    path: "/tmp/docs",
    isMain: false,
    agentId: "agt_codex",
    createdAt: "2026-07-14T08:00:00.000Z",
  };
}

function consoleState(): ConsoleSnapshot {
  return {
    namespace: "test",
    protocolVersion: "0.0.0",
    serverTime: "2026-07-14T09:10:00.000Z",
    device: {
      id: "dev_local",
      name: "Local bridge",
      status: "online",
      platform: "linux",
      architecture: "x64",
      lastSeenAt: "2026-07-14T09:10:00.000Z",
    },
    agent: null,
    agents: [{
      id: "agt_codex",
      name: "Codex",
      status: "enabled",
      location: { type: "local_device", deviceId: "dev_local" },
    }],
    projects: [{ id: "proj_docs", name: "Docs", color: "#123456", status: "active" }],
    worktrees: [worktree()],
    currentProjectId: "proj_docs",
    // Deliberately oldest-first: WorktreeView must determine latest by time.
    invocations: [{
      id: "inv_old",
      status: "failed",
      agentId: "agt_codex",
      projectId: "proj_docs",
      worktreeId: "wt_docs",
      createdAt: "2026-07-14T08:00:00.000Z",
      input: { task: "Old task" },
    }, {
      id: "inv_new",
      status: "succeeded",
      agentId: "agt_codex",
      projectId: "proj_docs",
      worktreeId: "wt_docs",
      createdAt: "2026-07-14T09:00:00.000Z",
      input: { task: "New task" },
    }],
    events: [],
    auditSummaries: [],
    approvalRequests: [],
  } as unknown as ConsoleSnapshot;
}
