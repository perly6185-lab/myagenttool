import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/lib/i18n";
import { ApiError } from "@/lib/api-client";
import type { LocalWorkItem } from "./task-view-types";
import { TaskMaterialEditor } from "./task-material-editor";

const mocks = vi.hoisted(() => ({
  createTaskMaterialDraft: vi.fn(),
  uploadTaskMaterialFile: vi.fn(),
  getTaskMaterialDraft: vi.fn(),
  removeTaskMaterialFile: vi.fn(),
  addWorkItemMaterials: vi.fn(),
  getTaskMaterialStorage: vi.fn(),
  cleanupTaskMaterialStorage: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@/data/use-console-actions", () => ({ api: mocks }));
vi.mock("@/hooks/use-page-navigation", () => ({ usePageNavigation: () => mocks.navigate }));

const task = {
  id: "work_1",
  projectId: "project_1",
  revision: 2,
  status: "in_progress",
  state: "open",
  executionState: "running",
} as LocalWorkItem;

describe("TaskMaterialEditor", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18n.changeLanguage("en-US");
    mocks.createTaskMaterialDraft.mockResolvedValue({ draft: { id: "draft_1", revision: 0 } });
    mocks.uploadTaskMaterialFile.mockResolvedValue({
      draft: { id: "draft_1", revision: 1, assets: [] },
      asset: { id: "asset_1" },
    });
    mocks.getTaskMaterialDraft.mockResolvedValue({ draft: { id: "draft_1", revision: 0, assets: [] } });
    mocks.addWorkItemMaterials.mockResolvedValue({
      workItem: { ...task, revision: 3, inputAssets: [{ id: "asset_1", originalName: "brief.txt" }] },
      appliesTo: "future_execution",
    });
    mocks.getTaskMaterialStorage.mockResolvedValue({
      usedBytes: 1_000,
      limitBytes: 1_000,
      reclaimableBytes: 100,
      draftCount: 1,
      fileCount: 1,
      completedTaskCount: 1,
      expiredDraftCount: 0,
      retentionDays: 30,
      previewToken: "preview-1",
    });
    mocks.cleanupTaskMaterialStorage.mockResolvedValue({
      reclaimedBytes: 100,
      fileCount: 1,
      draftCount: 1,
      usage: {
        usedBytes: 900,
        limitBytes: 1_000,
        reclaimableBytes: 0,
        draftCount: 0,
        fileCount: 0,
        completedTaskCount: 0,
        expiredDraftCount: 0,
        retentionDays: 30,
        previewToken: "preview-2",
      },
    });
  });

  afterEach(cleanup);

  it("uploads and attaches a selected file without a second confirmation", async () => {
    const onUpdated = vi.fn();
    const { container } = render(<TaskMaterialEditor item={task} onUpdated={onUpdated} />);
    fireEvent.click(screen.getByRole("button", { name: "Add reference files" }));
    expect(screen.getByText(/automatically/)).toBeTruthy();

    const input = container.querySelector('input[type="file"]');
    expect(input).toBeTruthy();
    fireEvent.change(input!, { target: { files: [new File(["brief"], "brief.txt", { type: "text/plain" })] } });

    await waitFor(() => expect(mocks.addWorkItemMaterials).toHaveBeenCalledWith("work_1", {
      expectedRevision: 2,
      materialDraftId: "draft_1",
      materialDraftRevision: 1,
    }));
    expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ revision: 3 }), expect.stringMatching(/This AI run is unchanged/));
    expect(screen.queryByRole("button", { name: "Add to task" })).toBeNull();
  });

  it("attaches the ready files after the user removes a failed file", async () => {
    const onUpdated = vi.fn();
    mocks.uploadTaskMaterialFile
      .mockResolvedValueOnce({ draft: { id: "draft_1", revision: 1 }, asset: { id: "asset_ready" } })
      .mockRejectedValueOnce(new Error("upload failed"));
    const { container } = render(<TaskMaterialEditor item={task} onUpdated={onUpdated} />);
    fireEvent.click(screen.getByRole("button", { name: "Add reference files" }));
    const input = container.querySelector('input[type="file"]');
    fireEvent.change(input!, { target: { files: [
      new File(["ready"], "ready.txt", { type: "text/plain" }),
      new File(["failed"], "failed.txt", { type: "text/plain" }),
    ] } });

    const removeFailed = await screen.findByRole("button", { name: "Remove failed.txt" });
    fireEvent.click(removeFailed);
    await waitFor(() => expect(mocks.addWorkItemMaterials).toHaveBeenCalled());
    expect(onUpdated).toHaveBeenCalledTimes(1);
  });

  it("cancels an active upload and reconciles the draft before leaving the task unchanged", async () => {
    const onUpdated = vi.fn();
    mocks.uploadTaskMaterialFile.mockImplementation((_projectId, _draftId, _fileId, _file, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Canceled", "AbortError")), { once: true });
    }));
    const { container } = render(<TaskMaterialEditor item={task} onUpdated={onUpdated} />);
    fireEvent.click(screen.getByRole("button", { name: "Add reference files" }));
    const input = container.querySelector('input[type="file"]');
    fireEvent.change(input!, { target: { files: [new File(["brief"], "brief.txt", { type: "text/plain" })] } });

    fireEvent.click(await screen.findByRole("button", { name: "Cancel upload: brief.txt" }));
    await waitFor(() => expect(mocks.getTaskMaterialDraft).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/Upload canceled/)).toBeTruthy();
    expect(mocks.addWorkItemMaterials).not.toHaveBeenCalled();
  });

  it("frees safe local space in place and retries the selected file automatically", async () => {
    mocks.uploadTaskMaterialFile
      .mockRejectedValueOnce(new ApiError(
        "task_material_local_capacity_exceeded",
        "Local storage is full.",
        413,
      ))
      .mockResolvedValueOnce({
        draft: { id: "draft_1", revision: 1, assets: [] },
        asset: { id: "asset_1" },
      });
    const onUpdated = vi.fn();
    const { container } = render(<TaskMaterialEditor item={task} onUpdated={onUpdated} />);
    fireEvent.click(screen.getByRole("button", { name: "Add reference files" }));
    const input = container.querySelector('input[type="file"]');
    fireEvent.change(input!, { target: { files: [new File(["brief"], "brief.txt", { type: "text/plain" })] } });

    const manage = await screen.findByRole("button", { name: "Manage local storage" });
    fireEvent.click(manage);
    expect(await screen.findByRole("dialog", { name: "Free local space and continue adding?" })).toBeTruthy();
    expect(screen.getByText(/completed tasks past retention: 1/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Free 100 B and retry automatically" }));

    await waitFor(() => expect(mocks.cleanupTaskMaterialStorage).toHaveBeenCalledWith("preview-1"));
    await waitFor(() => expect(mocks.uploadTaskMaterialFile).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onUpdated).toHaveBeenCalled());
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("keeps the selected file visible and offers full settings when nothing is safe to clean", async () => {
    mocks.uploadTaskMaterialFile.mockRejectedValue(new ApiError(
      "task_material_local_capacity_exceeded",
      "Local storage is full.",
      413,
    ));
    mocks.getTaskMaterialStorage.mockResolvedValue({
      usedBytes: 1_000,
      limitBytes: 1_000,
      reclaimableBytes: 0,
      draftCount: 0,
      fileCount: 0,
      completedTaskCount: 0,
      expiredDraftCount: 0,
      retentionDays: 30,
      previewToken: "preview-empty",
    });
    const { container } = render(<TaskMaterialEditor item={task} onUpdated={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add reference files" }));
    const input = container.querySelector('input[type="file"]');
    fireEvent.change(input!, { target: { files: [new File(["brief"], "brief.txt", { type: "text/plain" })] } });

    fireEvent.click(await screen.findByRole("button", { name: "Manage local storage" }));
    expect(await screen.findByText(/selected file stays here/)).toBeTruthy();
    expect(screen.getByText("brief.txt")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open full storage management" }));
    expect(mocks.navigate).toHaveBeenCalledWith("settings");
  });
});
