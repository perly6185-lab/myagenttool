import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/request";
import { i18n } from "@/lib/i18n";
import type { LocalContentRecord } from "./local-content-types";
import type { LocalWorkItem } from "@/features/tasks/task-view-types";
import { LocalLibraryView, openTasksFor } from "./local-library-view";

const mocks = vi.hoisted(() => ({
  stats: vi.fn(),
  search: vi.fn(),
  rebuild: vi.fn(),
  archive: vi.fn(),
  addToWorkItem: vi.fn(),
  preview: vi.fn(),
  reveal: vi.fn(),
  createTask: vi.fn(),
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
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18n.changeLanguage("en-US");
    mocks.stats.mockResolvedValue({ catalog: {
      schemaVersion: 1,
      total: 1,
      available: 1,
      byKind: { article: { count: 1, available: 1 } },
      facets: {
        projects: [{ value: "project-a", count: 1 }],
        workItems: [{ value: "open-a", count: 1 }],
        sources: [{ value: "article_import", count: 1 }],
        months: [{ value: "2026-08", count: 1 }],
        availability: [{ value: "available", count: 1 }],
        indexStatuses: [{ value: "ready", count: 1 }],
        mailAccounts: [{ value: "mail_app", label: "Work Mail", count: 4 }],
        mailFolders: [{ value: "inbox", accountId: "mail_app", accountLabel: "Work Mail", path: "INBOX", count: 4 }],
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
        source: { type: "channel_article_import", id: "article-1" },
        sourceLabel: "Project A · Prepare design",
        matchSnippet: null,
        occurredAt: null,
        importedAt: null,
        modifiedAt: null,
        original: { available: true, reason: null },
        indexStatus: "ready",
        metadata: { channelKnowledgeItemId: "channel_knowledge_1" },
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
    mocks.archive.mockResolvedValue({ archived: true, originalDeleted: false, contentId: "lc_11111111111111111111111111111111" });
    mocks.createTask.mockResolvedValue({ workItem: {
      id: "created-a", projectId: "project-a", state: "open", status: "backlog",
      title: "Use Local architecture brief", revision: 1,
    } });
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

  it("lets ordinary users choose a non-blocking reference", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(createElement(QueryClientProvider, { client }, createElement(LocalLibraryView)));

    fireEvent.click(await screen.findByRole("button", { name: "Add to task" }));
    expect(await screen.findByRole("dialog", { name: "Add content reference" })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Target task" })).toBeTruthy());
    fireEvent.change(await screen.findByRole("combobox", { name: /^How AI should use it/ }), { target: { value: "reference" } });
    fireEvent.click(screen.getByRole("button", { name: "Add reference" }));

    await waitFor(() => expect(mocks.addToWorkItem).toHaveBeenCalledWith(
      "open-a",
      expect.objectContaining({ purpose: "reference" }),
    ));
  });

  it("creates an unfinished task when there is no eligible target, then adds the reference", async () => {
    mocks.listWorkItems.mockResolvedValueOnce({ workItems: [], count: 0, hasMore: false, nextCursor: null });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(createElement(QueryClientProvider, { client }, createElement(LocalLibraryView)));

    fireEvent.click(await screen.findByRole("button", { name: "Add to task" }));
    expect(await screen.findByText(/No unfinished task/i)).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "New task name" }) as HTMLInputElement).value)
      .toBe("Use Local architecture brief");
    fireEvent.click(screen.getByRole("button", { name: "Create task and add" }));

    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-a",
      title: "Use Local architecture brief",
    })));
    await waitFor(() => expect(mocks.addToWorkItem).toHaveBeenCalledWith(
      "created-a",
      expect.objectContaining({ expectedRevision: 1, purpose: "required_input" }),
    ));
    expect(await screen.findByText(/original was not moved/i)).toBeTruthy();
  });

  it("renders server-neutralized text and locates the original without displaying its host path", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(createElement(QueryClientProvider, { client }, createElement(LocalLibraryView)));

    fireEvent.click(await screen.findByRole("button", { name: "Safe preview" }));
    expect(await screen.findByText("Safe plain-text preview")).toBeTruthy();
    expect(screen.getByText(/Markdown is rendered safely/i)).toBeTruthy();
    fireEvent.click(within(screen.getByRole("dialog", { name: "Safe full-text preview" })).getByRole("button", { name: "Locate original" }));

    await waitFor(() => expect(mocks.reveal).toHaveBeenCalledWith("lc_11111111111111111111111111111111"));
    expect(await screen.findByText(/Located “brief.md”/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("C:\\");
  });

  it("removes a shared article from the library without deleting its original", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(createElement(QueryClientProvider, { client }, createElement(LocalLibraryView)));

    fireEvent.click(await screen.findByRole("button", { name: "View details" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove from library" }));
    await waitFor(() => expect(mocks.archive).toHaveBeenCalledWith("lc_11111111111111111111111111111111"));
    expect(await screen.findByText(/original article remains on this device/i)).toBeTruthy();
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

  it("shows the original file size when a safe preview is truncated", async () => {
    mocks.preview.mockResolvedValueOnce({ preview: {
      contentId: "lc_11111111111111111111111111111111",
      title: "Local architecture brief",
      kind: "article",
      format: "plain_text",
      text: "Bounded preview",
      truncated: true,
      bytesRead: 1024 * 1024,
      totalBytes: 5 * 1024 * 1024,
      mimeType: "text/markdown",
      originalName: "brief.md",
      activeContentExecuted: false,
      remoteResourcesLoaded: false,
    } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(createElement(QueryClientProvider, { client }, createElement(LocalLibraryView)));

    fireEvent.click(await screen.findByRole("button", { name: "Safe preview" }));
    expect(await screen.findByText(/original file 5 MB/i)).toBeTruthy();
  });

  it("browses logical task, source, month, availability, and index directories", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(createElement(QueryClientProvider, { client }, createElement(LocalLibraryView)));

    expect(await screen.findByText(/Project A · Prepare design/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "More filters" }));
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

  it("shows persistent library folders and filters from the directory", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(createElement(QueryClientProvider, { client }, createElement(LocalLibraryView)));

    const directory = await screen.findByRole("complementary", { name: "Library folders" });
    expect(within(directory).getByText("By type")).toBeTruthy();
    expect(within(directory).getByText("By project")).toBeTruthy();
    expect(within(directory).getByText("By source")).toBeTruthy();
    expect(within(directory).getByText("By date")).toBeTruthy();
    expect(within(directory).getByText("Original mail folders")).toBeTruthy();
    expect(within(directory).getByText("Work Mail")).toBeTruthy();
    expect(within(directory).getByText("Inbox")).toBeTruthy();
    fireEvent.click(within(directory).getByRole("button", { name: /Article/ }));

    await waitFor(() => expect(mocks.search).toHaveBeenLastCalledWith(expect.objectContaining({
      kinds: ["article"],
    })));

    fireEvent.click(within(directory).getByRole("button", { name: /Inbox/ }));
    await waitFor(() => expect(mocks.search).toHaveBeenLastCalledWith(expect.objectContaining({
      kinds: ["mail"],
      mailAccountId: "mail_app",
      mailFolderId: "inbox",
    })));
  });

  it("opens useful details even when the original is unavailable", async () => {
    const baseline = await mocks.search();
    mocks.search.mockClear();
    mocks.search.mockResolvedValue({
      ...baseline,
      results: baseline.results.map((record: LocalContentRecord) => ({
        ...record,
        kind: "mail",
        mimeType: null,
        storageMode: "state_record",
        original: { available: false, reason: "mail_original_not_archived" },
        indexStatus: "partial",
        metadata: { from: "sender@example.com", accountLabel: "Work mail", attachmentCount: 2 },
      })),
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(createElement(QueryClientProvider, { client }, createElement(LocalLibraryView)));

    fireEvent.click(await screen.findByRole("button", { name: "View details" }));
    const dialog = await screen.findByRole("dialog", { name: "Content details" });
    expect(within(dialog).getByText("sender@example.com")).toBeTruthy();
    expect(within(dialog).getByText("Work mail")).toBeTruthy();
    expect(within(dialog).getAllByText("Partial content index")).toHaveLength(2);
    expect(within(dialog).queryByRole("button", { name: "Safe preview" })).toBeNull();
  });
});
