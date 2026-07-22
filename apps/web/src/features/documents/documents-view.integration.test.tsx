import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentsView } from "@/features/documents/documents-view";

const mocks = vi.hoisted(() => ({
  projectDocuments: vi.fn(),
  officecliPreview: vi.fn(),
  issueApprovalGrant: vi.fn(),
  invokeCapability: vi.fn(),
  manageOfficeDocument: vi.fn(),
  importOfficeDocument: vi.fn(),
  selectProject: vi.fn(),
  setSection: vi.fn(),
  setOfficecliPreviewPath: vi.fn(),
  setSelectedProjectId: vi.fn(),
  setSelectedWorktreeId: vi.fn(),
}));

vi.mock("@/data/use-console-actions", () => ({
  api: {
    projectDocuments: mocks.projectDocuments,
    officecliPreview: mocks.officecliPreview,
    issueApprovalGrant: mocks.issueApprovalGrant,
    invokeCapability: mocks.invokeCapability,
    manageOfficeDocument: mocks.manageOfficeDocument,
    importOfficeDocument: mocks.importOfficeDocument,
    selectProject: mocks.selectProject,
  },
}));
vi.mock("@/data/use-console-state", () => ({
  useConsoleState: () => ({ data: {
    currentProjectId: "prj_1",
    projects: [{ id: "prj_1", name: "Demo" }],
    worktrees: [{ id: "wt_1", projectId: "prj_1", branchName: "docs" }],
  } }),
  useRefreshConsoleState: () => vi.fn(),
}));
vi.mock("@/store/ui-store", () => ({
  useUiStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    setSection: mocks.setSection,
    setOfficecliPreviewPath: mocks.setOfficecliPreviewPath,
    setSelectedProjectId: mocks.setSelectedProjectId,
    setSelectedWorktreeId: mocks.setSelectedWorktreeId,
  }),
}));

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), clear: () => values.clear() });
  window.history.replaceState({}, "", "/?section=documents");
  mocks.projectDocuments.mockResolvedValue({ projectId: "prj_1", worktreeId: null, truncated: false, scanned: 1, documents: [{ projectId: "prj_1", worktreeId: null, name: "report.docx", path: "docs/report.docx", type: "docx", gitStatus: "clean" }] });
  mocks.officecliPreview.mockResolvedValue({ path: "docs/report.docx", content: "<p>Report preview</p>" });
  mocks.issueApprovalGrant.mockResolvedValue({ token: "grant_1" });
  mocks.invokeCapability.mockResolvedValue({ invocationId: "inv_1" });
  mocks.manageOfficeDocument.mockResolvedValue({ operation: "copy", source: "docs/report.docx", destination: "docs/copy-of-report.docx" });
  mocks.importOfficeDocument.mockResolvedValue({ path: "docs/imported.docx", bytes: 4, type: "docx" });
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><DocumentsView /></QueryClientProvider>);
}

describe("DocumentsView interaction", () => {
  it("discovers, previews, filters, and hands a document to a worktree", async () => {
    renderView();
    fireEvent.click(await screen.findByText("report.docx"));
    expect(await screen.findByTitle("docs/report.docx")).toBeTruthy();
    fireEvent.click(screen.getByText("Word"));
    await waitFor(() => expect(mocks.projectDocuments).toHaveBeenCalledWith("prj_1", expect.objectContaining({ type: "docx" })));
    fireEvent.click(screen.getByText("Edit in worktree"));
    expect(mocks.setOfficecliPreviewPath).toHaveBeenCalledWith("docs/report.docx");
    expect(mocks.setSelectedWorktreeId).toHaveBeenCalledWith("wt_1");
    expect(mocks.setSection).toHaveBeenCalledWith("projects");
  });

  it("creates a worktree document from a template with JSON data", async () => {
    mocks.projectDocuments.mockImplementation((_projectId, options) => Promise.resolve({
      projectId: "prj_1",
      worktreeId: options.worktreeId ?? null,
      truncated: false,
      scanned: 1,
      documents: [{ projectId: "prj_1", worktreeId: options.worktreeId ?? null, name: "report.docx", path: "docs/report.docx", type: "docx", gitStatus: "clean" }],
    }));
    renderView();
    fireEvent.change(screen.getByLabelText("Document source"), { target: { value: "worktree" } });
    await waitFor(() => expect(mocks.projectDocuments).toHaveBeenCalledWith("prj_1", expect.objectContaining({ worktreeId: "wt_1" })));
    fireEvent.click(await screen.findByText("report.docx"));
    fireEvent.click(await screen.findByRole("button", { name: "Use as template" }));
    fireEvent.change(screen.getByLabelText("Template data (JSON)"), { target: { value: '{"title":"Quarterly"}' } });
    fireEvent.click(screen.getByRole("button", { name: "Create from template" }));
    await waitFor(() => expect(mocks.issueApprovalGrant).toHaveBeenCalledWith("wrapper:merge", "app_officecli"));
    expect(mocks.invokeCapability).toHaveBeenCalledWith("app.app_officecli.apply.merge", expect.objectContaining({
      projectId: "prj_1",
      worktreeId: "wt_1",
      template: "docs/report.docx",
      output: "copy-of-report.docx",
      data: { title: "Quarterly" },
      approvalToken: "grant_1",
    }));
  });

  it("copies and confirms deletion of a worktree document", async () => {
    mocks.projectDocuments.mockResolvedValue({ projectId: "prj_1", worktreeId: "wt_1", truncated: false, scanned: 1, documents: [{ projectId: "prj_1", worktreeId: "wt_1", name: "report.docx", path: "docs/report.docx", type: "docx", gitStatus: "modified" }] });
    renderView();
    fireEvent.change(screen.getByLabelText("Document source"), { target: { value: "worktree" } });
    fireEvent.click(await screen.findByText("report.docx"));
    fireEvent.click(await screen.findByLabelText("Copy document"));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Copy document" })).getByRole("button", { name: "Copy document" }));
    await waitFor(() => expect(mocks.manageOfficeDocument).toHaveBeenCalledWith("wt_1", { operation: "copy", source: "docs/report.docx", destination: "docs/copy-of-report.docx" }));
    mocks.manageOfficeDocument.mockResolvedValueOnce({ operation: "delete", source: "docs/report.docx" });
    fireEvent.click(await screen.findByLabelText("Delete document"));
    expect(screen.getByText(/permanently removes/)).toBeTruthy();
    fireEvent.click(within(screen.getByRole("dialog", { name: "Delete document" })).getByRole("button", { name: "Delete document" }));
    await waitFor(() => expect(mocks.manageOfficeDocument).toHaveBeenCalledWith("wt_1", { operation: "delete", source: "docs/report.docx" }));
  });

  it("renders saved template fields as a form and merges their values", async () => {
    localStorage.setItem("myagenttool.document-templates", JSON.stringify([{ id: "prj_1:wt_1:docs/report.docx", projectId: "prj_1", worktreeId: "wt_1", path: "docs/report.docx", type: "docx", name: "Quarterly report", fields: [{ key: "title", label: "Report title", defaultValue: "Q3" }] }]));
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Quarterly report" }));
    fireEvent.change(screen.getByLabelText("Report title"), { target: { value: "Q4 results" } });
    fireEvent.click(within(screen.getByRole("dialog", { name: "Create from template" })).getByRole("button", { name: "Create from template" }));
    await waitFor(() => expect(mocks.invokeCapability).toHaveBeenCalledWith("app.app_officecli.apply.merge", expect.objectContaining({ data: { title: "Q4 results" }, template: "docs/report.docx" })));
  });

  it("creates Word, Excel, and PowerPoint documents from the page", async () => {
    renderView();
    for (const [type, extension] of [["docx", "docx"], ["xlsx", "xlsx"], ["pptx", "pptx"]] as const) {
      fireEvent.click(screen.getByRole("button", { name: "New" }));
      const dialog = screen.getByRole("dialog", { name: "New Office document" });
      fireEvent.change(within(dialog).getByLabelText("Document type"), { target: { value: type } });
      fireEvent.change(within(dialog).getByLabelText("Destination in worktree"), { target: { value: `docs/new-${type}` } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Create document" }));
      await waitFor(() => expect(mocks.invokeCapability).toHaveBeenCalledWith("app.app_officecli.apply.create", expect.objectContaining({ file: `docs/new-${type}.${extension}`, worktreeId: "wt_1" })));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "New Office document" })).toBeNull());
    }
  });

  it("validates an empty import and imports a selected Office file", async () => {
    class MockFileReader {
      result: string | ArrayBuffer | null = null;
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      readAsDataURL() { this.result = "data:application/octet-stream;base64,UEsDBA=="; this.onload?.(); }
    }
    vi.stubGlobal("FileReader", MockFileReader);
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    let dialog = screen.getByRole("dialog", { name: "Import Office document" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Import document" }));
    expect(await within(dialog).findByText(/Choose a Word/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("Office file"), { target: { files: [new File(["PK"], "imported.docx")] } });
    dialog = screen.getByRole("dialog", { name: "Import Office document" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Import document" }));
    await waitFor(() => expect(mocks.importOfficeDocument).toHaveBeenCalledWith("wt_1", { destination: "docs/imported.docx", dataBase64: "UEsDBA==" }));
  });

  it("renames and moves a worktree document and surfaces conflicts", async () => {
    mocks.projectDocuments.mockResolvedValue({ projectId: "prj_1", worktreeId: "wt_1", truncated: false, scanned: 1, documents: [{ projectId: "prj_1", worktreeId: "wt_1", name: "report.docx", path: "docs/report.docx", type: "docx", gitStatus: "modified" }] });
    renderView();
    fireEvent.change(screen.getByLabelText("Document source"), { target: { value: "worktree" } });
    fireEvent.click(await screen.findByText("report.docx"));
    mocks.manageOfficeDocument.mockResolvedValueOnce({ operation: "rename", source: "docs/report.docx", destination: "docs/final.docx" });
    fireEvent.click(screen.getByLabelText("Rename document"));
    let dialog = screen.getByRole("dialog", { name: "Rename document" });
    fireEvent.change(within(dialog).getByLabelText("Destination in worktree"), { target: { value: "docs/final.docx" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Rename document" }));
    await waitFor(() => expect(mocks.manageOfficeDocument).toHaveBeenCalledWith("wt_1", { operation: "rename", source: "docs/report.docx", destination: "docs/final.docx" }));
    mocks.manageOfficeDocument.mockRejectedValueOnce(new Error("A document already exists at the destination."));
    fireEvent.click(await screen.findByLabelText("Move document"));
    dialog = screen.getByRole("dialog", { name: "Move document" });
    fireEvent.change(within(dialog).getByLabelText("Destination in worktree"), { target: { value: "archive/report.docx" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Move document" }));
    expect(await within(dialog).findByText("A document already exists at the destination.")).toBeTruthy();
  });

  it("marks stale recent documents and supports pin, remove, and clear", async () => {
    localStorage.setItem("myagenttool.recent-documents", JSON.stringify([
      { projectId: "missing", worktreeId: null, name: "lost.docx", path: "lost.docx", type: "docx", openedAt: "2026-01-01" },
      { projectId: "prj_1", worktreeId: "missing-wt", name: "branch.xlsx", path: "branch.xlsx", type: "xlsx", openedAt: "2026-01-02" },
      { projectId: "prj_1", worktreeId: null, name: "live.pptx", path: "live.pptx", type: "pptx", openedAt: "2026-01-03" },
    ]));
    renderView();
    expect(screen.getByRole("button", { name: /lost.docx.*unavailable/ })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: /branch.xlsx.*unavailable/ })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByLabelText("Pin live.pptx"));
    expect(screen.getByLabelText("Unpin live.pptx")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Remove recent lost.docx"));
    expect(screen.queryByText(/lost.docx/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByText("Recent")).toBeNull();
  });
});
