import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorktreeView } from "@/features/projects/worktree-view";
import { useUiStore } from "@/store/ui-store";
import type { ConsoleSnapshot, WorktreeSnapshot } from "@/lib/console-state";

const apiMock = vi.hoisted(() => ({
  fetchState: vi.fn(),
  listInvocationEvents: vi.fn(),
  listWorktreeFiles: vi.fn(),
  readWorktreeFile: vi.fn(),
  worktreeGit: vi.fn(),
  worktreeDiff: vi.fn(),
  uploadWorktreeAttachments: vi.fn(),
  createInvocation: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  fetchState: apiMock.fetchState,
  api: {
    listInvocationEvents: apiMock.listInvocationEvents,
    listWorktreeFiles: apiMock.listWorktreeFiles,
    readWorktreeFile: apiMock.readWorktreeFile,
    worktreeGit: apiMock.worktreeGit,
    worktreeDiff: apiMock.worktreeDiff,
    uploadWorktreeAttachments: apiMock.uploadWorktreeAttachments,
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
    worktreeOpenIntent: null,
    worktreeReviewContext: null,
    officecliPreviewPath: null,
  });
});

describe("WorktreeView session history", () => {
  it("consumes a task-result handoff and opens the unified diff directly", async () => {
    apiMock.fetchState.mockResolvedValue(consoleState());
    apiMock.listWorktreeFiles.mockResolvedValue({ tree: [] });
    apiMock.worktreeGit.mockResolvedValue({
      branch: "codex/session-history", clean: false, changedFiles: 1,
      hasUpstream: false, upstream: null, ahead: 1, behind: 0,
    });
    apiMock.worktreeDiff.mockResolvedValue({
      files: [{ path: "src/login.ts", index: "M", work: " ", untracked: false }],
      base: "main",
      diff: "diff --git a/src/login.ts b/src/login.ts\n@@ -1 +1 @@\n+const reviewed = true;",
      truncated: false,
    });
    apiMock.listInvocationEvents.mockResolvedValue({
      invocationId: "inv_new", events: [], nextCursor: null, hasMore: false, retentionTruncated: false,
    });
    useUiStore.setState({
      worktreeOpenIntent: { worktreeId: "wt_docs", view: "changes" },
      worktreeReviewContext: { workItemId: "lwi_review", worktreeId: "wt_docs" },
    });

    renderWorktree();

    expect(await screen.findByRole("button", { name: "src/login.ts" })).toBeTruthy();
    expect(await screen.findByText("+const reviewed = true;")).toBeTruthy();
    expect(apiMock.worktreeDiff).toHaveBeenCalledWith("wt_docs");
    expect(useUiStore.getState().worktreeOpenIntent).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Return to task" }));
    expect(useUiStore.getState().section).toBe("task");
    expect(useUiStore.getState().selectedWorkItemId).toBe("lwi_review");
    expect(useUiStore.getState().selectedWorktreeId).toBeNull();
    expect(useUiStore.getState().worktreeReviewContext).toBeNull();
  });

  it("opens a source delivery handed off from task results", async () => {
    apiMock.fetchState.mockResolvedValue(consoleState());
    apiMock.listWorktreeFiles.mockResolvedValue({ tree: [] });
    apiMock.readWorktreeFile.mockResolvedValue({ content: "{\"release\":true}" });
    apiMock.listInvocationEvents.mockResolvedValue({
      invocationId: "inv_new", events: [], nextCursor: null, hasMore: false, retentionTruncated: false,
    });
    useUiStore.setState({ officecliPreviewPath: "config/release.json" });

    renderWorktree();

    expect(await screen.findByText('{"release":true}')).toBeTruthy();
    expect(apiMock.readWorktreeFile).toHaveBeenCalledWith("wt_docs", "config/release.json");
    expect(useUiStore.getState().officecliPreviewPath).toBeNull();
  });

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

  it("submits one locked worktree snapshot with the attachment batch and explicit run options", async () => {
    const state = consoleState();
    state.invocations = [];
    state.agents[0] = {
      ...state.agents[0],
      adapter: {
        type: "cli",
        command: "codex",
        permissionMode: "auto",
        models: ["gpt-5.6-sol", "gpt-5.6-terra"],
        defaultModel: "gpt-5.6-terra",
      },
    } as typeof state.agents[number];
    apiMock.fetchState.mockResolvedValue(state);
    apiMock.listWorktreeFiles.mockResolvedValue({ tree: [] });
    apiMock.uploadWorktreeAttachments.mockResolvedValue({
      attachments: [{ name: "notes.txt", path: ".myagenttool/attachments/batch/notes.txt" }],
      skipped: [],
    });
    apiMock.createInvocation.mockResolvedValue({
      invocation: {
        id: "inv_submitted",
        status: "queued",
        agentId: "agt_codex",
        projectId: "proj_docs",
        worktreeId: "wt_docs",
        createdAt: "2026-07-14T09:12:00.000Z",
        input: { task: "Review docs" },
      },
    });

    const { container } = renderWorktree();
    await screen.findByRole("button", { name: "Run in this worktree" });
    fireEvent.change(screen.getByRole("textbox", { name: "Task" }), { target: { value: "Review docs" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Model" }), { target: { value: "gpt-5.6-sol" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Permission level" }), { target: { value: "full" } });
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(["hello"], "notes.txt", { type: "text/plain" })] },
    });
    await screen.findByText("notes.txt");
    fireEvent.click(screen.getByRole("button", { name: "Run in this worktree" }));

    await waitFor(() => expect(apiMock.uploadWorktreeAttachments).toHaveBeenCalledWith(
      "wt_docs",
      [{ name: "notes.txt", dataBase64: "aGVsbG8=" }],
      expect.any(String),
    ));
    const batchId = apiMock.uploadWorktreeAttachments.mock.calls[0]?.[2];
    expect(apiMock.createInvocation).toHaveBeenCalledWith(
      "Review docs\n\nAttached files (in the worktree):\n- .myagenttool/attachments/batch/notes.txt",
      "agt_codex",
      "proj_docs",
      "wt_docs",
      { permissionLevel: "full", model: "gpt-5.6-sol" },
      batchId,
    );
    await waitFor(() => expect(screen.queryByText("notes.txt")).toBeNull());
  });

  it("does not create a run or clear the draft when the server skips an attachment", async () => {
    const state = consoleState();
    state.invocations = [];
    apiMock.fetchState.mockResolvedValue(state);
    apiMock.listWorktreeFiles.mockResolvedValue({ tree: [] });
    apiMock.uploadWorktreeAttachments.mockResolvedValue({
      attachments: [],
      skipped: [{ name: "notes.txt", reason: "empty" }],
    });

    const { container } = renderWorktree();
    await screen.findByRole("button", { name: "Run in this worktree" });
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(["hello"], "notes.txt", { type: "text/plain" })] },
    });
    await screen.findByText("notes.txt");
    fireEvent.click(screen.getByRole("button", { name: "Run in this worktree" }));

    expect(await screen.findByText("The server rejected one or more attachments. Fix or remove them before retrying.")).toBeTruthy();
    expect(apiMock.createInvocation).not.toHaveBeenCalled();
    expect(screen.getByText("notes.txt")).toBeTruthy();
  });

  it("reuses the attachment batch and invocation key after a create response is lost", async () => {
    const state = consoleState();
    state.invocations = [];
    apiMock.fetchState.mockResolvedValue(state);
    apiMock.listWorktreeFiles.mockResolvedValue({ tree: [] });
    apiMock.uploadWorktreeAttachments.mockResolvedValue({
      attachments: [{ name: "notes.txt", path: ".myagenttool/attachments/retry/notes.txt" }],
      skipped: [],
    });
    apiMock.createInvocation
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce({
        invocation: {
          id: "inv_retry",
          status: "queued",
          agentId: "agt_codex",
          projectId: "proj_docs",
          worktreeId: "wt_docs",
          createdAt: "2026-07-14T09:12:30.000Z",
          input: { task: "Retry safely" },
        },
      });

    const { container } = renderWorktree();
    await screen.findByRole("button", { name: "Run in this worktree" });
    fireEvent.change(screen.getByRole("textbox", { name: "Task" }), { target: { value: "Retry safely" } });
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(["hello"], "notes.txt", { type: "text/plain" })] },
    });
    await screen.findByText("notes.txt");

    fireEvent.click(screen.getByRole("button", { name: "Run in this worktree" }));
    await waitFor(() => expect(apiMock.createInvocation).toHaveBeenCalledTimes(1));
    await screen.findByText("response lost");
    expect(screen.getByText("notes.txt")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Task" }) as HTMLTextAreaElement).value).toBe("Retry safely");

    fireEvent.click(screen.getByRole("button", { name: "Run in this worktree" }));
    expect(await screen.findByText("inv_retry · queued")).toBeTruthy();
    expect(apiMock.uploadWorktreeAttachments).toHaveBeenCalledTimes(2);
    expect(apiMock.createInvocation).toHaveBeenCalledTimes(2);
    const firstKey = apiMock.uploadWorktreeAttachments.mock.calls[0]?.[2];
    expect(apiMock.uploadWorktreeAttachments.mock.calls[1]?.[2]).toBe(firstKey);
    expect(apiMock.createInvocation.mock.calls[0]?.[5]).toBe(firstKey);
    expect(apiMock.createInvocation.mock.calls[1]?.[5]).toBe(firstKey);
    await waitFor(() => expect((screen.getByRole("textbox", { name: "Task" }) as HTMLTextAreaElement).value).toBe(""));
    await waitFor(() => expect(screen.queryByText("notes.txt")).toBeNull());
  });

  it("clears staged files and resets execution controls when switching directly from worktree A to B", async () => {
    const second = worktree({ id: "wt_other", branch: "feat/other", agentId: "agt_other" });
    const state = consoleState();
    state.invocations = [];
    state.worktrees = [worktree(), second];
    state.agents.push({
      id: "agt_other",
      name: "Other Codex",
      status: "enabled",
      location: { type: "local_device", deviceId: "dev_local" },
      adapter: { type: "cli", command: "codex", permissionMode: "full", models: ["gpt-5.6-terra"] },
    } as typeof state.agents[number]);
    apiMock.fetchState.mockResolvedValue(state);
    apiMock.listWorktreeFiles.mockResolvedValue({ tree: [] });

    const view = renderWorktree();
    await screen.findByRole("button", { name: "Run in this worktree" });
    fireEvent.change(view.container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(["hello"], "notes.txt", { type: "text/plain" })] },
    });
    await screen.findByText("notes.txt");
    fireEvent.change(screen.getByRole("combobox", { name: "Permission level" }), { target: { value: "auto" } });

    view.rerenderWorktree(second);

    await waitFor(() => expect(screen.queryByText("notes.txt")).toBeNull());
    await waitFor(() => expect((screen.getByRole("combobox", { name: "Agent" }) as HTMLSelectElement).value).toBe("agt_other"));
    await waitFor(() => expect((screen.getByRole("combobox", { name: "Permission level" }) as HTMLSelectElement).value).toBe("full"));
    expect((screen.getByRole("combobox", { name: "Model" }) as HTMLSelectElement).value).toBe("");
  });

  it("locks the task and execution selectors while the submitted snapshot is in flight", async () => {
    const state = consoleState();
    state.invocations = [];
    state.agents[0] = {
      ...state.agents[0],
      adapter: { type: "cli", command: "codex", models: ["gpt-5.6-sol"] },
    } as typeof state.agents[number];
    apiMock.fetchState.mockResolvedValue(state);
    apiMock.listWorktreeFiles.mockResolvedValue({ tree: [] });
    let resolveCreate!: (value: unknown) => void;
    apiMock.createInvocation.mockImplementation(() => new Promise((resolve) => {
      resolveCreate = resolve;
    }));

    const { container } = renderWorktree();
    const task = await screen.findByRole("textbox", { name: "Task" }) as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole("button", { name: "Run in this worktree" }));

    const fieldset = task.closest("fieldset") as HTMLFieldSetElement;
    await waitFor(() => expect(fieldset.disabled).toBe(true));
    expect(screen.getByRole("combobox", { name: "Agent" }).closest("fieldset")).toBe(fieldset);
    expect(screen.getByRole("combobox", { name: "Model" }).closest("fieldset")).toBe(fieldset);
    expect(screen.getByRole("combobox", { name: "Permission level" }).closest("fieldset")).toBe(fieldset);
    expect(container.querySelector('input[type="file"]')?.closest("fieldset")).toBe(fieldset);
    expect((screen.getByRole("button", { name: "Starting…" }) as HTMLButtonElement).disabled).toBe(true);

    resolveCreate({
      invocation: {
        id: "inv_locked",
        status: "queued",
        agentId: "agt_codex",
        projectId: "proj_docs",
        worktreeId: "wt_docs",
        createdAt: "2026-07-14T09:13:00.000Z",
        input: { task: task.value },
      },
    });
    await screen.findByText("inv_locked · queued");
  });
});

function renderWorktree(selectedWorktree = worktree()) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchInterval: false },
      mutations: { retry: false },
    },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <WorktreeView worktree={selectedWorktree} />
    </QueryClientProvider>,
  );
  return {
    ...view,
    rerenderWorktree(nextWorktree: WorktreeSnapshot) {
      view.rerender(
        <QueryClientProvider client={client}>
          <WorktreeView worktree={nextWorktree} />
        </QueryClientProvider>,
      );
    },
  };
}

function worktree(overrides: Partial<WorktreeSnapshot> = {}): WorktreeSnapshot {
  return {
    id: "wt_docs",
    projectId: "proj_docs",
    targetId: "target_docs",
    branch: "codex/session-history",
    path: "/tmp/docs",
    isMain: false,
    agentId: "agt_codex",
    createdAt: "2026-07-14T08:00:00.000Z",
    ...overrides,
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
