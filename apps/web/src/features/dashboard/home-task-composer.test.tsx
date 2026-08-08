import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/lib/i18n";
import { HomeTaskComposer } from "./home-task-composer";

const mocks = vi.hoisted(() => ({
  createWorkItem: vi.fn(),
  startWorkItemAutoRun: vi.fn(),
  createTaskMaterialDraft: vi.fn(),
  uploadTaskMaterialFile: vi.fn(),
  removeTaskMaterialFile: vi.fn(),
  autoRunReadiness: vi.fn(),
  suggestWorkItemDraft: vi.fn(),
}));

vi.mock("@/data/use-console-actions", () => ({
  api: {
    createWorkItem: mocks.createWorkItem,
    startWorkItemAutoRun: mocks.startWorkItemAutoRun,
    createTaskMaterialDraft: mocks.createTaskMaterialDraft,
    uploadTaskMaterialFile: mocks.uploadTaskMaterialFile,
    removeTaskMaterialFile: mocks.removeTaskMaterialFile,
    autoRunReadiness: mocks.autoRunReadiness,
    suggestWorkItemDraft: mocks.suggestWorkItemDraft,
  },
}));

beforeEach(async () => {
  await i18n.changeLanguage("en-US");
  mocks.autoRunReadiness.mockResolvedValue({ readiness: { ready: true, checks: [] } });
  mocks.suggestWorkItemDraft.mockResolvedValue({
    draft: {
      acceptanceCriteria: ["The requested outcome is complete"],
      verificationSop: ["Exercise the real user flow", "Review automated evidence"],
    },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("HomeTaskComposer", () => {
  function openComposer() {
    fireEvent.click(screen.getByTestId("home-create-task-trigger"));
    expect(screen.getByRole("dialog")).toBeTruthy();
  }

  it("keeps the creation action discoverable and opens the form on demand", () => {
    render(<HomeTaskComposer projectId="prj_1" onCreated={() => {}} onOpenTask={() => {}} />);

    expect(screen.queryByTestId("home-task-composer")).toBeNull();
    openComposer();
    expect(screen.getByTestId("home-task-composer")).toBeTruthy();
  });

  it("gives an empty-project user a direct setup action", () => {
    const onOpenProjects = vi.fn();
    render(<HomeTaskComposer inline projectId={null} onCreated={() => {}} onOpenTask={() => {}} onOpenProjects={onOpenProjects} />);

    expect(screen.getByText("Choose or create a project first.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open project setup" }));
    expect(onOpenProjects).toHaveBeenCalledTimes(1);
  });

  it("creates one durable task that the scheduler will run automatically", async () => {
    mocks.createWorkItem.mockResolvedValue({ workItem: { id: "lwi_new" } });
    const onCreated = vi.fn();
    const onOpenTask = vi.fn();
    render(<HomeTaskComposer projectId="prj_1" projectName="Customer work" onCreated={onCreated} onOpenTask={onOpenTask} />);
    openComposer();

    fireEvent.change(screen.getByRole("textbox", { name: "Create a task" }), {
      target: { value: "Prepare the weekly customer update\nUse plain language." },
    });
    fireEvent.click(screen.getByText("Add completion criteria or references"));
    fireEvent.change(screen.getByPlaceholderText(/One item per line/), {
      target: { value: "Cover every open risk\nProduce a shareable document" },
    });
    await waitFor(() => expect((screen.getByRole("button", { name: "Create and let AI work" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Create and let AI work" }));

    await waitFor(() => expect(mocks.createWorkItem).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "prj_1",
      title: "Prepare the weekly customer update",
      body: "Prepare the weekly customer update\nUse plain language.",
      acceptanceCriteria: ["Cover every open risk", "Produce a shareable document"],
      verificationSop: [],
      waitingOn: "ai",
      executionPolicy: "auto",
      status: "ready",
      plannedDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      idempotencyKey: expect.any(String),
    })));
    expect(mocks.startWorkItemAutoRun).not.toHaveBeenCalled();
    expect(mocks.suggestWorkItemDraft).not.toHaveBeenCalled();
    expect(await screen.findByText(/AI will work automatically/)).toBeTruthy();
    expect(onCreated).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "View task" }));
    expect(onOpenTask).toHaveBeenCalledWith("lwi_new");
  });

  it("keeps an automatically queued task accessible without a second start request", async () => {
    mocks.createWorkItem.mockResolvedValue({ workItem: { id: "lwi_partial" } });
    const onOpenTask = vi.fn();
    render(<HomeTaskComposer projectId="prj_1" onCreated={() => {}} onOpenTask={onOpenTask} />);
    openComposer();

    fireEvent.change(screen.getByRole("textbox", { name: "Create a task" }), { target: { value: "Draft a launch note" } });
    await waitFor(() => expect((screen.getByRole("button", { name: "Create and let AI work" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Create and let AI work" }));

    expect(await screen.findByText(/AI will work automatically/)).toBeTruthy();
    expect(mocks.startWorkItemAutoRun).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "View task" }));
    expect(onOpenTask).toHaveBeenCalledWith("lwi_partial");
  });

  it("adds optional reference files without exposing the advanced runner", async () => {
    const draft = {
      id: "draft_1", projectId: "prj_1", status: "draft", revision: 0, workItemId: null,
      assets: [], createdAt: "2026-08-05T00:00:00Z", updatedAt: "2026-08-05T00:00:00Z", expiresAt: "2026-08-06T00:00:00Z",
    } as const;
    mocks.createTaskMaterialDraft.mockResolvedValue({ draft });
    mocks.uploadTaskMaterialFile.mockResolvedValue({
      draft: { ...draft, revision: 1, assets: [{ id: "asset_1", originalName: "brief.txt" }] },
      asset: { id: "asset_1", originalName: "brief.txt" },
    });
    mocks.createWorkItem.mockResolvedValue({ workItem: { id: "lwi_with_file" } });
    render(
      <HomeTaskComposer
        projectId="prj_1"
        onCreated={() => {}}
        onOpenTask={() => {}}
      />,
    );
    openComposer();

    fireEvent.change(screen.getByRole("textbox", { name: "Create a task" }), { target: { value: "Summarize the attached brief" } });
    fireEvent.click(screen.getByText("Add completion criteria or references"));
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File(["brief"], "brief.txt", { type: "text/plain" })] } });
    expect(await screen.findByText("brief.txt")).toBeTruthy();
    await waitFor(() => expect(mocks.uploadTaskMaterialFile).toHaveBeenCalledWith(
      "prj_1", "draft_1", expect.any(String), expect.objectContaining({ name: "brief.txt" }),
    ));
    fireEvent.click(screen.getByRole("button", { name: "Create task only" }));

    await waitFor(() => expect(mocks.createWorkItem).toHaveBeenCalledWith(expect.objectContaining({
      materialDraftId: "draft_1",
      materialDraftRevision: 1,
    })));
    expect(mocks.createWorkItem.mock.calls[0]?.[0]).not.toHaveProperty("inputAssets");
    expect(mocks.createWorkItem.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ waitingOn: "none", plannedDate: null, executionPolicy: "manual" }));
  });

  it("blocks create-and-run before creating a task and routes the user to the precise setup section", async () => {
    mocks.autoRunReadiness.mockResolvedValue({
      readiness: { ready: false, checks: [{ key: "agent", label: "Coding agent", status: "blocked", detail: "No default agent." }] },
    });
    const onOpenSetup = vi.fn();
    render(<HomeTaskComposer inline projectId="prj_1" onCreated={() => {}} onOpenTask={() => {}} onOpenSetup={onOpenSetup} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Create a task" }), { target: { value: "Prepare a release note" } });
    expect((await screen.findByRole("alert", { name: "Preflight" })).textContent).toContain("No default agent");
    expect((screen.getByRole("button", { name: "Create and let AI work" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Open setup and fix" }));

    expect(onOpenSetup).toHaveBeenCalledWith("agents");
    expect(mocks.createWorkItem).not.toHaveBeenCalled();
  });

  it("queues an AI task while execution capacity is temporarily full", async () => {
    mocks.autoRunReadiness.mockResolvedValue({
      readiness: { ready: false, checks: [{ key: "capacity", label: "Capacity", status: "blocked", detail: "At capacity: 1/1." }] },
    });
    mocks.createWorkItem.mockResolvedValue({ workItem: { id: "lwi_queued" } });
    render(<HomeTaskComposer inline projectId="prj_1" onCreated={() => {}} onOpenTask={() => {}} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Create a task" }), { target: { value: "Queue the next task" } });
    const action = await screen.findByRole("button", { name: "Create and let AI work" });
    await waitFor(() => expect((action as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(action);

    await waitFor(() => expect(mocks.createWorkItem).toHaveBeenCalledWith(expect.objectContaining({
      status: "ready",
      executionPolicy: "auto",
    })));
  });

  it("clears project-bound material state on project switch and disables creation while offline", async () => {
    const draft = {
      id: "draft_1", projectId: "prj_1", status: "draft", revision: 0, workItemId: null,
      assets: [], createdAt: "2026-08-05T00:00:00Z", updatedAt: "2026-08-05T00:00:00Z", expiresAt: "2026-08-06T00:00:00Z",
    } as const;
    mocks.createTaskMaterialDraft.mockResolvedValue({ draft });
    mocks.uploadTaskMaterialFile.mockResolvedValue({ draft: { ...draft, revision: 1 }, asset: { id: "asset_1" } });
    const view = render(<HomeTaskComposer inline projectId="prj_1" onCreated={() => {}} onOpenTask={() => {}} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Create a task" }), { target: { value: "Review the brief" } });
    fireEvent.click(screen.getByText("Add completion criteria or references"));
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(["brief"], "brief.txt", { type: "text/plain" })] },
    });
    expect(await screen.findByText("brief.txt")).toBeTruthy();

    view.rerender(<HomeTaskComposer inline projectId="prj_2" unavailable onCreated={() => {}} onOpenTask={() => {}} />);
    await waitFor(() => expect(screen.queryByText("brief.txt")).toBeNull());
    expect(screen.getByText(/previous project were cleared/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Create task only" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
