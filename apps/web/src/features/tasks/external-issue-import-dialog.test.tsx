import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import { i18n } from "@/lib/i18n";
import { ExternalIssueImportDialog } from "./external-issue-import-dialog";
import type { LocalWorkItem } from "./task-view-types";

const mocks = vi.hoisted(() => ({
  listWorkItemExternalProviders: vi.fn(),
  listGithubItems: vi.fn(),
  createWorkItemFromExternal: vi.fn(),
  listWorkItemExternalIssues: vi.fn(),
}));

vi.mock("@/data/use-console-actions", () => ({
  api: {
    listWorkItemExternalProviders: mocks.listWorkItemExternalProviders,
    listGithubItems: mocks.listGithubItems,
    createWorkItemFromExternal: mocks.createWorkItemFromExternal,
    listWorkItemExternalIssues: mocks.listWorkItemExternalIssues,
  },
}));

const projects = [{ id: "prj_1", name: "Console" }];
const imported = {
  id: "lwi_9",
  localRef: "LOCAL-9",
  projectId: "prj_1",
  title: "External request",
} as LocalWorkItem;

beforeEach(async () => {
  await i18n.changeLanguage("en-US");
  mocks.listWorkItemExternalProviders.mockResolvedValue({
    providers: [
      { id: "github", label: "GitHub", apiSync: true, webhook: true },
      { id: "gitlab", label: "GitLab", apiSync: true, webhook: false },
      { id: "gitea", label: "Gitea", apiSync: false, webhook: false },
    ],
  });
  mocks.listGithubItems.mockResolvedValue({ available: true, message: "", items: [] });
  mocks.createWorkItemFromExternal.mockResolvedValue({ workItem: imported });
  mocks.listWorkItemExternalIssues.mockResolvedValue({
    issues: [
      { number: 11, title: "First open issue", body: "", state: "open", labels: ["p1"], repository: "group/repo", url: null },
      { number: 12, title: "Second open issue", body: "", state: "open", labels: [], repository: "group/repo", url: null },
    ],
    page: 1,
    hasMore: true,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("external issue import", () => {
  it("preflights GitHub and creates a task without starting AI", async () => {
    const onImported = vi.fn();
    render(
      <ExternalIssueImportDialog
        open
        projects={projects}
        repoProjectIds={new Set(["prj_1"])}
        initialProjectId="prj_1"
        onClose={() => {}}
        onImported={onImported}
      />,
    );

    expect(await screen.findByText("The repository and GitHub CLI connection are ready.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Issue number"), { target: { value: "42" } });
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));

    await waitFor(() => expect(mocks.createWorkItemFromExternal).toHaveBeenCalledWith({
      projectId: "prj_1",
      provider: "github",
      issueNumber: 42,
      relation: "source",
      isPrimary: true,
      syncPolicy: "manual",
    }));
    expect(onImported).toHaveBeenCalledWith(imported, { provider: "github", duplicate: false });
  });

  it("shows configuration readiness and blocks an unconfigured provider", async () => {
    render(
      <ExternalIssueImportDialog
        open
        projects={projects}
        repoProjectIds={new Set(["prj_1"])}
        onClose={() => {}}
        onImported={() => {}}
      />,
    );

    await screen.findByText("The repository and GitHub CLI connection are ready.");
    fireEvent.change(screen.getByLabelText("Source provider"), { target: { value: "gitea" } });
    expect(await screen.findByText(/API not configured/)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("owner/repo"), { target: { value: "owner/repo" } });
    fireEvent.change(screen.getByLabelText("Issue number"), { target: { value: "7" } });
    expect(screen.getByRole("button", { name: "Create task" }).hasAttribute("disabled")).toBe(true);
  });

  it("opens an already-linked task instead of leaving a duplicate error", async () => {
    const onImported = vi.fn();
    mocks.createWorkItemFromExternal.mockRejectedValue(new ApiError(
      "external_issue_already_linked",
      "external_issue_already_linked",
      409,
      { workItem: imported, workItemId: imported.id },
    ));
    render(
      <ExternalIssueImportDialog
        open
        projects={projects}
        repoProjectIds={new Set(["prj_1"])}
        onClose={() => {}}
        onImported={onImported}
      />,
    );

    await screen.findByText("The repository and GitHub CLI connection are ready.");
    fireEvent.change(screen.getByLabelText("Source provider"), { target: { value: "gitlab" } });
    fireEvent.change(screen.getByPlaceholderText("owner/repo"), { target: { value: "group/repo" } });
    fireEvent.change(screen.getByLabelText("Issue number"), { target: { value: "19" } });
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));

    await waitFor(() => expect(onImported).toHaveBeenCalledWith(imported, { provider: "gitlab", duplicate: true }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("searches and bulk imports GitLab issues with mobile-friendly selectable cards", async () => {
    const onImported = vi.fn();
    mocks.createWorkItemFromExternal
      .mockResolvedValueOnce({ workItem: { ...imported, id: "lwi_11", localRef: "LOCAL-11" } })
      .mockResolvedValueOnce({ workItem: { ...imported, id: "lwi_12", localRef: "LOCAL-12" } });
    render(
      <ExternalIssueImportDialog open projects={projects} repoProjectIds={new Set(["prj_1"])} onClose={() => {}} onImported={onImported} />,
    );
    await screen.findByText("The repository and GitHub CLI connection are ready.");
    fireEvent.change(screen.getByLabelText("Source provider"), { target: { value: "gitlab" } });
    fireEvent.change(screen.getByLabelText("External repository"), { target: { value: "group/repo" } });
    fireEvent.change(screen.getByLabelText("Search titles or descriptions"), { target: { value: "open" } });
    fireEvent.click(screen.getByRole("button", { name: "Find issues" }));

    expect(await screen.findByText("#11 First open issue")).toBeTruthy();
    expect(mocks.listWorkItemExternalIssues).toHaveBeenCalledWith({ provider: "gitlab", projectId: "prj_1", repository: "group/repo", query: "open", page: 1, limit: 20 });
    fireEvent.click(screen.getByRole("checkbox", { name: /#11 First open issue/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /#12 Second open issue/ }));
    fireEvent.click(screen.getByRole("button", { name: "Import selected issues" }));

    await waitFor(() => expect(mocks.createWorkItemFromExternal).toHaveBeenCalledTimes(2));
    expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ id: "lwi_11" }), { provider: "gitlab", duplicate: false, importedCount: 2 });
  });
});
