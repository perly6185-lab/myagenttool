import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/request";
import type { LocalContentRecord } from "./local-content-types";
import type { LocalWorkItem } from "@/features/tasks/task-view-types";
import { LocalLibraryView, openTasksFor } from "./local-library-view";

const mocks = vi.hoisted(() => ({
  stats: vi.fn(),
  search: vi.fn(),
  rebuild: vi.fn(),
  addToWorkItem: vi.fn(),
  preview: vi.fn(),
  reveal: vi.fn(),
  listWorkItems: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("./local-content-api", () => ({ localContentApi: mocks }));
vi.mock("@/data/use-console-state", () => ({ useConsoleState: () => ({ data: { projects: [{ id: "project-a", name: "Project A" }] } }) }));
vi.mock("@/hooks/use-page-navigation", () => ({ usePageNavigation: () => mocks.navigate }));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { listWorkItems: mocks.listWorkItems },
}));

function content(projectId: string | null) {
  return { projectId } as LocalContentRecord;
}

const tasks = [
  { id: "open-a", projectId: "project-a", state: "open", status: "ready" },
  { id: "done-a", projectId: "project-a", state: "closed", status: "done" },
  { id: "open-b", projectId: "project-b", state: "open", status: "in_progress" },
] as LocalWorkItem[];

describe("local library task targeting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.stats.mockResolvedValue({ catalog: {
      schemaVersion: 1,
      total: 1,
      available: 1,
      byKind: {},
      facets: {
        projects: [{ value: "project-a", count: 1 }],
        workItems: [{ value: "open-a", count: 1 }],
        sources: [{ value: "article_import", count: 1 }],
        months: [{ value: "2026-08", count: 1 }],
        availability: [{ value: "available", count: 1 }],
        indexStatuses: [{ value: "ready", count: 1 }],
      },
      lastRebuiltAt: null,
      rebuildable: true,
    } });
    mocks.search.mockResolvedValue({
      results: [{
        id: "lc_11111111111111111111111111111111",
        kind: "article",
        title: "Local architecture brief",
        summary: "One authoritative original with disposable execution copies.",
        projectId: "project-a",
        workItemId: null,
        storageMode: "referenced",
        root: { kind: "project", id: "project-a" },
        relativePath: "docs/brief.md",
        stateLocator: null,
        mimeType: "text/markdown",
        size: 100,
        source: { type: "article", id: "article-1" },
        sourceLabel: "Project A · Prepare design",
        matchSnippet: null,
        occurredAt: null,
        importedAt: null,
        modifiedAt: null,
        original: { available: true, reason: null },
        indexStatus: "ready",
        metadata: {},
        relations: [],
      }],
      count: 1,
      query: "",
      limit: 30,
      offset: 0,
      hasMore: false,
      nextCursor: null,
      retrieval: { mode: "metadata_recent", offline: true },
    });
    mocks.listWorkItems.mockResolvedValue({ workItems: [{ ...tasks[0], title: "Prepare design", localRef: "TASK-1", revision: 3 }], count: 1 });
    mocks.addToWorkItem.mockResolvedValue({ workItem: { ...tasks[0], title: "Prepare design", localRef: "TASK-1", revision: 4 } });
    mocks.preview.mockResolvedValue({ preview: {
      contentId: "lc_11111111111111111111111111111111",
      title: "Local architecture brief",
      kind: "article",
      format: "plain_text",
      text: "Safe plain-text preview",
      truncated: false,
      bytesRead: 23,
      totalBytes: 23,
      mimeType: "text/markdown",
      originalName: "brief.md",
      activeContentExecuted: false,
      remoteResourcesLoaded: false,
    } });
    mocks.reveal.mockResolvedValue({ revealed: true, name: "brief.md" });
  });

  afterEach(cleanup);

  it("only offers unfinished tasks from the original's project", () => {
    expect(openTasksFor(content("project-a"), tasks).map((item) => item.id)).toEqual(["open-a"]);
  });

  it("offers unfinished tasks from every project for global content such as archived mail", () => {
    expect(openTasksFor(content(null), tasks).map((item) => item.id)).toEqual(["open-a", "open-b"]);
  });

  it("adds a search result to an unfinished task without moving the original", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(createElement(QueryClientProvider, { client }, createElement(LocalLibraryView)));

    fireEvent.click(await screen.findByRole("button", { name: "Add to task" }));
    expect(await screen.findByRole("dialog", { name: "Add content reference" })).toBeTruthy();
    await waitFor(() => expect((screen.getByRole("combobox", { name: "Target task" }) as HTMLSelectElement).value).toBe("open-a"));
    fireEvent.click(screen.getByRole("button", { name: "Add reference" }));

    await waitFor(() => expect(mocks.addToWorkItem).toHaveBeenCalledWith(
      "open-a",
      { contentId: "lc_11111111111111111111111111111111", expectedRevision: 3, purpose: "required_input" },
    ));
    expect(await screen.findByText(/original was not moved/i)).toBeTruthy();
  });

  it("renders server-neutralized text and locates the original without displaying its host path", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(createElement(QueryClientProvider, { client }, createElement(LocalLibraryView)));

    fireEvent.click(await screen.findByRole("button", { name: "Safe preview" }));
    expect(await screen.findByText("Safe plain-text preview")).toBeTruthy();
    expect(screen.getByText(/HTML and scripts are not executed/i)).toBeTruthy();
    fireEvent.click(within(screen.getByRole("dialog", { name: "Safe full-text preview" })).getByRole("button", { name: "Locate original" }));

    await waitFor(() => expect(mocks.reveal).toHaveBeenCalledWith("lc_11111111111111111111111111111111"));
    expect(await screen.findByText(/Located “brief.md”/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("C:\\");
  });

  it("explains when a scanned PDF needs OCR instead of attempting an unsafe preview", async () => {
    mocks.preview.mockRejectedValueOnce(new ApiError(
      "local_content_preview_needs_ocr",
      "OCR required",
      415,
    ));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(createElement(QueryClientProvider, { client }, createElement(LocalLibraryView)));

    fireEvent.click(await screen.findByRole("button", { name: "Safe preview" }));
    expect(await screen.findByText(/currently needs OCR/i)).toBeTruthy();
    expect(within(screen.getByRole("dialog", { name: "Safe full-text preview" }))
      .getByRole("button", { name: "Locate original" })).toBeTruthy();
  });

  it("browses logical task, source, month, availability, and index directories", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(createElement(QueryClientProvider, { client }, createElement(LocalLibraryView)));

    expect(await screen.findByText(/Project A · Prepare design/)).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Related task" }), { target: { value: "open-a" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Source" }), { target: { value: "article_import" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Date directory" }), { target: { value: "2026-08" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Original status" }), { target: { value: "available" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Index status" }), { target: { value: "ready" } });

    await waitFor(() => expect(mocks.search).toHaveBeenLastCalledWith(expect.objectContaining({
      workItemId: "open-a",
      sourceType: "article_import",
      yearMonth: "2026-08",
      availability: "available",
      indexStatus: "ready",
    })));
  });
});
