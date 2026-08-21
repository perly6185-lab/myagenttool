import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveWorkItemUserStatus, WorkItemSummaryView } from "./work-item-summary-view";
import type { LocalWorkItem } from "./task-view-types";
import { i18n } from "@/lib/i18n";
import { useUiStore } from "@/store/ui-store";

const mocks = vi.hoisted(() => ({
  getWorkItem: vi.fn(),
  updateWorkItem: vi.fn(),
  suggestWorkItemDraft: vi.fn(),
  listMyTemplateDefinitions: vi.fn(),
  recordMyTemplateOutcomeFeedback: vi.fn(),
  previewMyTemplateDraft: vi.fn(),
  createMyTemplateDraft: vi.fn(),
  listWorkItemComments: vi.fn(),
  createWorkItemComment: vi.fn(),
  recordWorkItemProgress: vi.fn(),
  retryAutoRun: vi.fn(),
  startWorkItemAutoRun: vi.fn(),
  answerClarify: vi.fn(),
  cancelAutoRun: vi.fn(),
  autoRunReadiness: vi.fn(),
  recordWorkItemVerification: vi.fn(),
  transitionWorkItem: vi.fn(),
  deliverWorkItem: vi.fn(),
  syncWorkItemExternalIssue: vi.fn(),
  syncWorkItemGithubIssue: vi.fn(),
  removeWorkItemMaterial: vi.fn(),
  restoreWorkItemMaterial: vi.fn(),
  projectAssetDescriptor: vi.fn(),
  projectAssetPreview: vi.fn(),
  projectAssetPreviewBytes: vi.fn(),
  projectPdfSource: vi.fn(),
  officecliPreview: vi.fn(),
  readWorktreeFile: vi.fn(),
  revealProjectAsset: vi.fn(),
  revealTaskMaterial: vi.fn(),
  previewTaskMaterialOffice: vi.fn(),
  taskMaterialContentUrl: vi.fn((workItemId, assetId, download = false) => `/materials/${workItemId}/${assetId}${download ? "?download=1" : ""}`),
  previewLocalContent: vi.fn(),
  previewLocalContentAsset: vi.fn(),
  revealLocalContent: vi.fn(),
}));

vi.mock("@/data/use-console-state", () => ({
  useConsoleState: () => ({ data: { users: [{ id: "usr_1", name: "Morgan" }] } }),
}));

vi.mock("@/data/use-console-actions", () => ({
  api: {
    getWorkItem: mocks.getWorkItem,
    updateWorkItem: mocks.updateWorkItem,
    suggestWorkItemDraft: mocks.suggestWorkItemDraft,
    listMyTemplateDefinitions: mocks.listMyTemplateDefinitions,
    recordMyTemplateOutcomeFeedback: mocks.recordMyTemplateOutcomeFeedback,
    previewMyTemplateDraft: mocks.previewMyTemplateDraft,
    createMyTemplateDraft: mocks.createMyTemplateDraft,
    listWorkItemComments: mocks.listWorkItemComments,
    createWorkItemComment: mocks.createWorkItemComment,
    recordWorkItemProgress: mocks.recordWorkItemProgress,
    retryAutoRun: mocks.retryAutoRun,
    startWorkItemAutoRun: mocks.startWorkItemAutoRun,
    answerClarify: mocks.answerClarify,
    cancelAutoRun: mocks.cancelAutoRun,
    autoRunReadiness: mocks.autoRunReadiness,
    recordWorkItemVerification: mocks.recordWorkItemVerification,
    transitionWorkItem: mocks.transitionWorkItem,
    deliverWorkItem: mocks.deliverWorkItem,
    syncWorkItemExternalIssue: mocks.syncWorkItemExternalIssue,
    syncWorkItemGithubIssue: mocks.syncWorkItemGithubIssue,
    removeWorkItemMaterial: mocks.removeWorkItemMaterial,
    restoreWorkItemMaterial: mocks.restoreWorkItemMaterial,
    projectAssetDescriptor: mocks.projectAssetDescriptor,
    projectAssetPreview: mocks.projectAssetPreview,
    projectAssetPreviewBytes: mocks.projectAssetPreviewBytes,
    projectPdfSource: mocks.projectPdfSource,
    officecliPreview: mocks.officecliPreview,
    readWorktreeFile: mocks.readWorktreeFile,
    revealProjectAsset: mocks.revealProjectAsset,
    revealTaskMaterial: mocks.revealTaskMaterial,
    previewTaskMaterialOffice: mocks.previewTaskMaterialOffice,
    taskMaterialContentUrl: mocks.taskMaterialContentUrl,
  },
}));

vi.mock("@/features/local-content/local-content-api", () => ({
  localContentApi: {
    preview: mocks.previewLocalContent,
    previewAssetBytes: mocks.previewLocalContentAsset,
    reveal: mocks.revealLocalContent,
  },
}));

function item(overrides: Partial<LocalWorkItem> = {}): LocalWorkItem {
  return {
    id: "lwi_1",
    localRef: "LOCAL-1",
    projectId: "prj_1",
    title: "Prepare customer update",
    body: "Summarize the outcome in plain language.",
    type: "task",
    status: "in_progress",
    priority: "p1",
    state: "open",
    labels: [],
    assigneeIds: ["usr_1"],
    followUpSchemaVersion: 1,
    requesterRelation: "customer",
    requesterName: "Alex",
    requesterOrganization: "Acme",
    requesterUserId: null,
    intakeChannel: "meeting",
    externalReference: null,
    waitingOn: "ai",
    commitmentDate: null,
    nextFollowUpAt: null,
    lastProgressAt: null,
    lastProgressSummary: "AI is preparing the draft.",
    acceptanceCriteria: ["Customer-ready summary"],
    verificationSop: ["Review the customer-facing result"],
    executionContractSource: "manual",
    executionContractConfirmedAt: "2026-08-05T00:00:00.000Z",
    executionContractGate: { ready: true, missing: [], source: "manual", confirmedAt: "2026-08-05T00:00:00.000Z" },
    dueDate: "2026-08-06",
    plannedDate: "2026-08-05",
    milestone: "",
    estimatePoints: 1,
    revision: 2,
    archivedAt: null,
    updatedAt: "2026-08-05T00:00:00.000Z",
    executionState: "running",
    ...overrides,
  };
}

beforeEach(async () => {
  await i18n.changeLanguage("en-US");
  window.history.replaceState({}, "", "/?section=dashboard");
  useUiStore.setState({
    section: "dashboard", surfaceReturnSection: null, selectedWorkItemId: "lwi_1",
    selectedProjectId: null, selectedWorktreeId: null, officecliPreviewPath: null,
  });
  mocks.listWorkItemComments.mockResolvedValue({ comments: [] });
  mocks.autoRunReadiness.mockResolvedValue({ readiness: { ready: true, checks: [] } });
  mocks.projectAssetDescriptor.mockResolvedValue({ descriptor: { path: "summary/REPORT.md" } });
  mocks.projectAssetPreview.mockResolvedValue({ path: "summary/REPORT.md", text: "# Report\n\nThe report is ready.", size: 40, truncated: false });
  mocks.readWorktreeFile.mockResolvedValue({ content: "plain text", truncated: false });
  mocks.previewLocalContent.mockResolvedValue({
    preview: {
      contentId: "lc_0123456789abcdef0123456789abcdef",
      title: "Saved article",
      kind: "article",
      format: "plain_text",
      text: "# Saved article\n\nThe article is available locally.",
      truncated: false,
      bytesRead: 55,
      totalBytes: 55,
      mimeType: "text/markdown",
      originalName: "saved-article.md",
      activeContentExecuted: false,
      remoteResourcesLoaded: false,
    },
  });
  mocks.revealLocalContent.mockResolvedValue({ revealed: true, name: "saved-article.md" });
  mocks.previewLocalContentAsset.mockResolvedValue(new ArrayBuffer(8));
  window.myagenttoolDesktop = undefined;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("work item summary presentation", () => {
  it("explains the automatically matched My template without asking the user to choose it", async () => {
    mocks.getWorkItem.mockResolvedValue({
      workItem: item({
        myTemplateBinding: {
          schemaVersion: 1,
          definitionId: "rtd_quote",
          familyId: "family_quote",
          version: 2,
          name: "Customer quotation",
          expectedOutput: "Quotation workbook",
          matchReasons: ["The requested result matches a quotation workbook"],
          snapshot: {
            name: "Customer quotation",
            description: "Turn an inquiry into a checked quotation.",
            expectedOutput: "Quotation workbook",
            steps: [
              { key: "extract", kind: "extract", label: "Extract inquiry items", required: true },
              { key: "generate", kind: "generate", label: "Generate quotation", required: true },
            ],
          },
          snapshotHash: "abc123",
          matchedAt: "2026-08-05T00:00:00.000Z",
        },
      }),
    });
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} />);

    const template = await screen.findByTestId("work-item-template-binding");
    expect(template.textContent).toContain("How this task will produce its result");
    expect(template.textContent).toContain("Selected from the result");
    expect(template.textContent).toContain("Basis: a previously confirmed approach");
    expect(template.textContent).toContain("Quotation workbook");
    expect(template.textContent).toContain("The requested result matches a quotation workbook");
    expect(screen.queryByRole("combobox", { name: /template/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Wrong result" })).toBeNull();

    fireEvent.click(within(template).getByText("View processing steps"));
    expect(template.textContent).toContain("Extract inquiry items");
    expect(template.textContent).toContain("Generate quotation");
  });

  it("shows the ordinary-user work mode and keeps professional trace collapsed", async () => {
    mocks.getWorkItem.mockResolvedValue({
      workItem: item({
        channelTaskContract: {
          schemaVersion: 1,
          source: "channel",
          domain: "office",
          riskLevel: "low",
          goal: "整理订单",
          workMode: {
            schemaVersion: 1,
            state: "matched",
            source: "my_template",
            name: "订单跟进",
            version: 2,
            confidence: "high",
            goal: "整理订单",
            expectedOutput: "订单跟进结果",
            inputs: "订单资料",
            data: { status: "ready", requirements: [], sources: [{ sourceId: "orders", fileName: "订单.xlsx", revision: 3, fingerprint: "hash" }], relations: [], relationStatus: "ready" },
            mutation: { required: false, status: "not_required", targetCount: 0, digest: null },
            confirmationRequired: false,
            candidates: [],
            trace: { templateDefinitionId: "def", templateFamilyId: "family", templateVersion: 2, templateMatchReason: "strong", dataPlanDigest: "plan", relationDigest: "relation", executionDigest: "execution" },
            digest: "snapshot",
            generatedAt: "2026-08-05T00:00:00.000Z",
          },
        },
      }),
    });
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} />);

    const mode = await screen.findByTestId("work-mode-summary");
    expect(mode.textContent).toContain("How I’ll handle this");
    expect(mode.textContent).toContain("订单跟进");
    expect(mode.textContent).toContain("订单.xlsx");
    expect(within(mode).getByText("View supporting details").closest("details")?.open).toBe(false);
  });

  it("lets an ordinary user correct an unstarted task by choosing the desired result", async () => {
    const original = item({
      status: "backlog",
      executionState: "unclaimed",
      plannedDate: null,
      waitingOn: "none",
      myTemplateBinding: {
        schemaVersion: 1,
        definitionId: "rtd_quote",
        familyId: "family_quote",
        version: 1,
        name: "Customer quotation",
        expectedOutput: "Quotation workbook",
        matchReasons: ["The task looked like a quotation"],
        snapshot: {
          name: "Customer quotation",
          description: "Prepare a quotation",
          expectedOutput: "Quotation workbook",
          steps: [{ key: "quote", kind: "generate", label: "Generate quotation", required: true }],
        },
        snapshotHash: "quote-hash",
        matchedAt: "2026-08-05T00:00:00.000Z",
      },
    });
    const summaryDefinition = {
      id: "rtd_summary", familyId: "family_summary", projectId: "prj_1", sourceId: "src_1",
      name: "Inquiry summary", description: "Summarize inquiries", version: 2, state: "published",
      historicalCaseIds: [], triggerDocumentTypes: ["inquiry"],
      steps: [{ key: "summary", kind: "generate", label: "Generate summary", required: true, dependsOn: [], evidenceRefs: [], configuration: { output: "Inquiry summary" } }],
    };
    const corrected = item({
      ...original,
      revision: 3,
      myTemplateBinding: {
        schemaVersion: 1,
        definitionId: "rtd_summary",
        familyId: "family_summary",
        version: 2,
        name: "Inquiry summary",
        expectedOutput: "Inquiry summary",
        matchReasons: ["You corrected the desired result to “Inquiry summary”"],
        snapshot: {
          name: "Inquiry summary",
          description: "Summarize inquiries",
          expectedOutput: "Inquiry summary",
          steps: [{ key: "summary", kind: "generate", label: "Generate summary", required: true }],
        },
        snapshotHash: "summary-hash",
        matchedAt: "2026-08-05T00:01:00.000Z",
      },
    });
    mocks.getWorkItem.mockResolvedValue({ workItem: original });
    mocks.listMyTemplateDefinitions.mockResolvedValue({ routineDefinitions: [summaryDefinition] });
    mocks.updateWorkItem.mockResolvedValue({ workItem: corrected });
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "Wrong result" }));
    expect(await screen.findByRole("region", { name: "Correct the result" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: /template/i })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Inquiry summary" }));

    await waitFor(() => expect(mocks.updateWorkItem).toHaveBeenCalledWith("lwi_1", {
      expectedRevision: 2,
      myTemplateBinding: {
        definitionId: "rtd_summary",
        familyId: "family_summary",
        version: 2,
        matchReasons: ["You corrected the desired result to “Inquiry summary”"],
      },
    }));
    expect(await screen.findByText(/correction will help with similar tasks later/i)).toBeTruthy();
    expect(screen.getByTestId("work-item-template-binding").textContent).toContain("Inquiry summary");
  });

  it("explains when a task match used a previously corrected choice", async () => {
    mocks.getWorkItem.mockResolvedValue({
      workItem: item({
        myTemplateBinding: {
          schemaVersion: 1,
          definitionId: "rtd_summary",
          familyId: "family_summary",
          version: 2,
          name: "Inquiry summary",
          expectedOutput: "Inquiry summary",
          matchReasons: ["参考了你之前对相似任务的纠正"],
          snapshot: { name: "Inquiry summary", description: "Summarize inquiries", expectedOutput: "Inquiry summary", steps: [] },
          snapshotHash: "summary-hash",
          matchedAt: "2026-08-05T00:01:00.000Z",
        },
      }),
    });
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} />);

    const template = await screen.findByTestId("work-item-template-binding");
    expect(template.textContent).toContain("Learned from your correction");
    expect(template.textContent).toContain("similar to one you corrected before");
    expect(template.textContent).toContain("remembered choice in settings");
  });

  it("turns a completed result into a reusable task or follow-up draft", async () => {
    const onCreateTaskDraft = vi.fn();
    mocks.getWorkItem.mockResolvedValue({
      workItem: item({
        state: "closed",
        status: "done",
        executionState: "completed",
        lastProgressSummary: "The customer update was delivered.",
      }),
    });
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} onCreateTaskDraft={onCreateTaskDraft} />);

    fireEvent.click(await screen.findByRole("button", { name: "Reuse as new task" }));
    expect(onCreateTaskDraft).toHaveBeenLastCalledWith("Prepare customer update\nSummarize the outcome in plain language.");

    fireEvent.click(screen.getByRole("button", { name: "Create follow-up" }));
    expect(onCreateTaskDraft).toHaveBeenLastCalledWith(expect.stringContaining("Follow up on “Prepare customer update”"));
  });

  it("saves a completed ordinary task as a new learning My template after confirming the extracted result", async () => {
    const completed = item({
      state: "closed",
      status: "done",
      executionState: "completed",
      lastProgressSummary: "The customer update was delivered.",
      outputAssets: [{
        id: "output-1", path: "customer-update.docx", family: "document", terminalId: "dev_local",
        hash: "output-hash", version: "v1", capabilities: [], readiness: { state: "ready", reason: "completed" },
      }],
    });
    const draft = {
      id: "mtd_1", projectId: "prj_1", name: "Customer update", typicalInput: "Customer notes",
      expectedOutput: "Customer update document", applicability: "When customer notes need an update",
      steps: ["Read notes", "Prepare update", "Check result"], state: "needs_review" as const,
      caseCount: 1, casesRequired: 1, revision: 1,
      origin: { kind: "work_item" as const, workItemId: "lwi_1", localRef: "LOCAL-1", title: "Prepare customer update" },
      createdAt: "2026-08-05T00:00:00.000Z", updatedAt: "2026-08-05T00:00:00.000Z",
    };
    mocks.getWorkItem.mockResolvedValue({ workItem: completed });
    mocks.previewMyTemplateDraft.mockResolvedValue({
      eligible: true, alreadySaved: false, reasons: [], draft: null,
      suggestion: {
        name: "Customer update", typicalInput: "Customer notes", expectedOutput: "Customer update document",
        applicability: "When customer notes need an update", steps: draft.steps,
      },
      evidence: { inputCount: 0, outputCount: 1, passedVerification: true, passedAcceptance: true, hasDeliveryReport: true },
    });
    mocks.createMyTemplateDraft.mockResolvedValue({ workItem: item({ ...completed, myTemplateDraft: draft }), draft });
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "Save as My template" }));
    expect(await screen.findByRole("heading", { name: "Save as a new My template" })).toBeTruthy();
    expect(screen.getByDisplayValue("Customer update")).toBeTruthy();
    expect(screen.getByText(/One case is enough to review and enable/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm and save template" }));

    await waitFor(() => expect(mocks.createMyTemplateDraft).toHaveBeenCalledWith("lwi_1", expect.objectContaining({
      expectedRevision: 2,
      confirm: true,
      name: "Customer update",
      typicalInput: "Customer notes",
      expectedOutput: "Customer update document",
    })));
    expect(await screen.findByText("Saved for review and activation")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save as My template" })).toBeNull();
  });

  it("records whether a completed My template result met expectations without conflating technical failures", async () => {
    const completedTemplate = item({
      state: "closed",
      status: "done",
      executionState: "completed",
      myTemplateBinding: {
        schemaVersion: 1, definitionId: "rtd_summary", familyId: "family_summary", version: 2,
        name: "Inquiry summary", expectedOutput: "Inquiry summary", matchReasons: ["Expected result matched"],
        snapshot: { name: "Inquiry summary", description: "Summarize inquiries", expectedOutput: "Inquiry summary", steps: [] },
        snapshotHash: "summary-hash", matchedAt: "2026-08-05T00:00:00.000Z",
      },
    });
    const positiveFeedback = {
      id: "mtof_1", outcome: "met_expectations" as const, note: "",
      definitionId: "rtd_summary", familyId: "family_summary", version: 2, revision: 1,
      createdAt: "2026-08-05T01:00:00.000Z", updatedAt: "2026-08-05T01:00:00.000Z",
    };
    mocks.getWorkItem.mockResolvedValue({ workItem: completedTemplate });
    mocks.recordMyTemplateOutcomeFeedback.mockResolvedValue({
      workItem: item({ ...completedTemplate, myTemplateOutcomeFeedback: positiveFeedback }),
    });
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} />);

    const feedback = await screen.findByLabelText("Did this result meet your expectations?");
    expect(feedback.textContent).toContain("run failures are not treated as template problems");
    fireEvent.click(within(feedback).getByRole("button", { name: "Met expectations" }));
    await waitFor(() => expect(mocks.recordMyTemplateOutcomeFeedback).toHaveBeenCalledWith("lwi_1", {
      outcome: "met_expectations",
    }));
    expect(await within(feedback).findByText("Feedback recorded")).toBeTruthy();
    expect(within(feedback).getByText("Met expectations")).toBeTruthy();
  });

  it("presents an Issue-bound article import as a completed managed execution", async () => {
    mocks.getWorkItem.mockResolvedValue({
      workItem: item({
        state: "closed",
        status: "done",
        waitingOn: "none",
        executionState: "completed",
        executionKind: "article_import",
        executionBindings: [{
          kind: "article_import",
          targetId: "article_import_1",
          worktreeId: "wtr_article",
          createdAt: "2026-08-05T00:00:00.000Z",
        }],
        acceptanceResults: [{
          criterion: "Customer-ready summary",
          status: "passed",
          note: "Imported and checked",
          verificationId: "ver_article",
        }],
        verificationRecords: [{
          id: "ver_article",
          kind: "manual",
          status: "passed",
          command: null,
          summary: "Imported the public article and verified its output files.",
          evidence: [],
          recordedAt: "2026-08-05T01:00:00.000Z",
          recordedBy: "usr_1",
        }],
        outputAssets: [{
          id: "asset_article",
          path: "docs/imported/article.md",
          family: "markdown",
          terminalId: "dev_local",
          hash: null,
          version: null,
          worktreeId: "wtr_article",
          capabilities: [],
          readiness: { state: "ready", reason: "article_import_completed" },
        }],
      }),
    });
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "View result" }));
    expect(screen.getByText("Article import result")).toBeTruthy();
    expect(screen.getByText("The article import passed task acceptance")).toBeTruthy();
    expect(screen.getByText("Imported the public article and verified its output files.")).toBeTruthy();
    expect(screen.getByText("Article import")).toBeTruthy();
    expect(screen.queryByText("What AI delivered")).toBeNull();
    expect(screen.queryByText(/review evidence is incomplete/i)).toBeNull();
  });

  it("derives one user-facing status from business, planning, and execution state", () => {
    expect(deriveWorkItemUserStatus(item({ state: "closed" }))).toBe("completed");
    expect(deriveWorkItemUserStatus(item({ executionState: "failed" }))).toBe("needs_action");
    expect(deriveWorkItemUserStatus(item({ executionState: "completed" }))).toBe("ready_for_review");
    expect(deriveWorkItemUserStatus(item({ executionState: "completed", waitingOn: "me" }))).toBe("ready_for_review");
    expect(deriveWorkItemUserStatus(item({ executionState: "awaiting_approval", waitingOn: "me" }))).toBe("needs_action");
    expect(deriveWorkItemUserStatus(item({ status: "blocked", executionState: "unclaimed" }))).toBe("blocked");
    expect(deriveWorkItemUserStatus(item({ executionState: "running" }))).toBe("ai_working");
    expect(deriveWorkItemUserStatus(item({ executionState: "unclaimed", plannedDate: null, waitingOn: "requester" }))).toBe("waiting");
    expect(deriveWorkItemUserStatus(
      item({ status: "review", executionState: "verifying", waitingOn: "me" }),
      { id: "aur_report", status: "report_posted", phase: "review_ready", updatedAt: "2026-08-05T01:00:00.000Z" },
    )).toBe("ready_for_review");
  });

  it("shows safe reference actions and explains removal during an active AI run", async () => {
    const withMaterial = item({
      inputAssets: [{
        id: "asset_1", originalName: "brief.txt", path: ".myagenttool/inputs/lwi_1/asset_1--brief.txt",
        family: "text", mimeType: "text/plain", terminalId: "dev_local", size: 512,
        resourceClass: "small", hash: "hash", version: null, worktreeId: null, capabilities: [],
        readiness: { state: "ready", reason: "task_material_claimed" },
      }],
    });
    mocks.getWorkItem.mockResolvedValue({ workItem: withMaterial });
    mocks.removeWorkItemMaterial.mockResolvedValue({ workItem: { ...withMaterial, inputAssets: [], revision: 3 }, appliesTo: "future_execution" });
    mocks.restoreWorkItemMaterial.mockResolvedValue({ workItem: { ...withMaterial, revision: 4 }, appliesTo: "future_execution" });
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} />);

    await screen.findByText("Prepare customer update");
    expect(screen.getByText("brief.txt")).toBeTruthy();
    expect(screen.getByText(/Materials used by this AI run will not change/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Preview: brief.txt" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download: brief.txt" })).toBeTruthy();
    mocks.revealTaskMaterial.mockResolvedValue({ revealed: true, name: "brief.txt" });
    fireEvent.click(screen.getByRole("button", { name: "Open containing folder: brief.txt" }));
    await waitFor(() => expect(mocks.revealTaskMaterial).toHaveBeenCalledWith("lwi_1", "asset_1"));
    fireEvent.click(screen.getByRole("button", { name: "Preview: brief.txt" }));
    const preview = screen.getByRole("dialog", { name: "brief.txt" });
    expect(within(preview).getByTitle("Preview: brief.txt").getAttribute("src")).toBe("/materials/lwi_1/asset_1");
    fireEvent.click(within(preview).getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove: brief.txt" }));
    await waitFor(() => expect(mocks.removeWorkItemMaterial).toHaveBeenCalledWith("lwi_1", "asset_1", 2));
    expect(await screen.findByText(/This AI run is unchanged/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(mocks.restoreWorkItemMaterial).toHaveBeenCalledWith("lwi_1", "asset_1", 3));
    expect(await screen.findByText(/brief\.txt: Reference file restored/)).toBeTruthy();
  });

  it("keeps the task usable when comments fail and retries a failed task load in place", async () => {
    mocks.getWorkItem
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ workItem: item() });
    mocks.listWorkItemComments.mockRejectedValueOnce(new Error("comments unavailable"));
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} />);

    expect((await screen.findByRole("alert")).textContent).toContain("could not be loaded");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Prepare customer update")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Update progress" })).toBeTruthy();
  });

  it("shows plain-language failure guidance and sends diagnostics to the expert process section", async () => {
    mocks.getWorkItem.mockResolvedValue({ workItem: item({ executionState: "failed" }) });
    const onOpenExpert = vi.fn();
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={onOpenExpert} />);

    expect(await screen.findByText("Needs your action")).toBeTruthy();
    expect(screen.getByText("The AI execution did not succeed.")).toBeTruthy();
    expect(screen.queryByText(/revision/i)).toBeNull();
    expect(screen.queryByText(/Auto-run/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Review and resolve" }));
    expect(onOpenExpert).toHaveBeenCalledWith("process");
  });

  it("previews an Excel reference file inside the task with OfficeCLI", async () => {
    const withWorkbook = item({
      inputAssets: [{
        id: "asset_xlsx", originalName: "DMA-information.xlsx", path: ".myagenttool/inputs/lwi_1/asset_xlsx--DMA-information.xlsx",
        family: "document", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", terminalId: "dev_local", size: 6144,
        resourceClass: "small", hash: "hash", version: null, worktreeId: null, capabilities: [],
        readiness: { state: "ready", reason: "task_material_claimed" },
      }],
    });
    mocks.getWorkItem.mockResolvedValue({ workItem: withWorkbook });
    mocks.previewTaskMaterialOffice.mockResolvedValue({
      path: "DMA-information.xlsx", content: "<table><tr><td>DMA 242 E</td></tr></table>", mime: "text/html", encoding: "utf8", bytes: 52,
    });
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} />);

    expect(await screen.findByRole("button", { name: "Preview: DMA-information.xlsx" })).toBeTruthy();
    expect(screen.queryByText("This format supports download only")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Preview: DMA-information.xlsx" }));

    await waitFor(() => expect(mocks.previewTaskMaterialOffice).toHaveBeenCalledWith("lwi_1", "asset_xlsx"));
    const preview = await screen.findByRole("dialog", { name: "DMA-information.xlsx" });
    expect(within(preview).getByTitle("Preview: DMA-information.xlsx").getAttribute("srcdoc")).toContain("DMA 242 E");
  });

  it("keeps produced files visible when the latest AI run failed", async () => {
    mocks.getWorkItem.mockResolvedValue({
      workItem: item({
        executionState: "failed",
        outputAssets: [{
          id: "asset_failed_run", path: "deliverables/verified.xlsx", family: "excel", terminalId: "local",
          hash: "sha256", version: "1", worktreeId: "wtr_1", capabilities: ["preview"],
          readiness: { state: "ready", reason: "available_on_owning_terminal" },
        }],
      }),
      observability: { latestRun: { id: "aur_failed", status: "failed" } },
    });
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} />);

    expect(await screen.findByText("Files involved")).toBeTruthy();
    expect(screen.getByText("verified.xlsx")).toBeTruthy();
    expect(screen.getByText(/did not finish normally/)).toBeTruthy();
  });

  it("retries a failed AI run in simple details after a plain-language confirmation", async () => {
    mocks.getWorkItem.mockResolvedValue({
      workItem: item({ executionState: "failed" }),
      observability: { latestRun: { id: "aur_failed", status: "failed" } },
    });
    mocks.retryAutoRun.mockResolvedValue({ autoRun: { id: "aur_failed", status: "materializing" } });
    const changed = vi.fn();
    window.addEventListener("myagenttool:state-change", changed);
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "Retry AI work" }));
    expect(screen.getByRole("dialog", { name: "Retry AI work?" })).toBeTruthy();
    expect(screen.getByText(/additional run time and cost/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(mocks.retryAutoRun).toHaveBeenCalledWith("aur_failed"));
    expect(await screen.findByText(/AI work restarted/)).toBeTruthy();
    expect(changed).toHaveBeenCalledTimes(1);
    window.removeEventListener("myagenttool:state-change", changed);
  });

  it("enables automatic AI work from a tracked task without opening expert details", async () => {
    mocks.getWorkItem.mockResolvedValue({
      workItem: item({
        status: "ready",
        executionState: undefined,
        plannedDate: null,
        waitingOn: "none",
        executionBindings: [],
      }),
    });
    mocks.updateWorkItem.mockResolvedValue({ workItem: item({ status: "ready", executionPolicy: "auto", waitingOn: "ai" }) });
    const onOpenExpert = vi.fn();
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={onOpenExpert} />);

    fireEvent.click(await screen.findByRole("button", { name: "Let AI start" }));

    await waitFor(() => expect(mocks.updateWorkItem).toHaveBeenCalledWith("lwi_1", expect.objectContaining({ executionPolicy: "auto", waitingOn: "ai" })));
    expect(mocks.startWorkItemAutoRun).not.toHaveBeenCalled();
    expect(await screen.findByText(/set to automatic/i)).toBeTruthy();
    expect(onOpenExpert).not.toHaveBeenCalled();
  });

  it("blocks AI start until project preflight is ready and opens the safe fix", async () => {
    mocks.getWorkItem.mockResolvedValue({
      workItem: item({ status: "ready", executionState: undefined, plannedDate: null, waitingOn: "none", executionBindings: [] }),
    });
    mocks.autoRunReadiness.mockResolvedValue({
      readiness: { ready: false, checks: [{ key: "agent", label: "Coding agent", status: "blocked", detail: "No default agent is configured." }] },
    });
    const onOpenSetup = vi.fn();
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} onOpenSetup={onOpenSetup} />);

    expect((await screen.findByRole("alert", { name: "Preflight" })).textContent).toContain("does not have an available task assistant");
    expect(screen.queryByText(/No default agent/)).toBeNull();
    expect((screen.getByRole("button", { name: "Let AI start" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Choose task assistant" }));
    expect(onOpenSetup).toHaveBeenCalledWith("autoRuns");
    expect(mocks.startWorkItemAutoRun).not.toHaveBeenCalled();
  });

  it("rechecks a transient preflight failure in place and enables AI start", async () => {
    mocks.getWorkItem.mockResolvedValue({
      workItem: item({ status: "ready", executionState: undefined, plannedDate: null, waitingOn: "none", executionBindings: [] }),
    });
    mocks.autoRunReadiness
      .mockRejectedValueOnce(new Error("temporary network failure"))
      .mockResolvedValueOnce({ readiness: { ready: true, checks: [] } });
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} />);

    expect((await screen.findByRole("alert", { name: "Preflight" })).textContent).toContain("could not be confirmed");
    fireEvent.click(screen.getByRole("button", { name: "Recheck" }));

    await waitFor(() => expect(mocks.autoRunReadiness).toHaveBeenCalledTimes(2));
    await waitFor(() => expect((screen.getByRole("button", { name: "Let AI start" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("shows an external source and makes manual writeback explicit", async () => {
    const onOpenExpert = vi.fn();
    mocks.getWorkItem.mockResolvedValue({
      workItem: item({
        status: "done",
        state: "closed",
        executionState: "completed",
        externalBindings: [{
          kind: "gitlab_issue",
          provider: "gitlab",
          resourceType: "issue",
          number: 19,
          url: "https://gitlab.example/group/repo/-/issues/19",
          lastSyncedAt: "2026-08-05T00:00:00.000Z",
          relation: "source",
          isPrimary: true,
          syncPolicy: "manual",
          conflict: null,
        }],
      }),
    });
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={onOpenExpert} />);

    expect(await screen.findByText("GitLab #19")).toBeTruthy();
    expect(screen.getByText(/external issue will not close automatically/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open external issue" }).getAttribute("href"))
      .toBe("https://gitlab.example/group/repo/-/issues/19");
    fireEvent.click(screen.getByRole("button", { name: "Manage sync" }));
    expect(onOpenExpert).toHaveBeenCalledWith("trace");
  });

  it("keeps a failed task unchanged and hides technical errors when retry is rejected", async () => {
    mocks.getWorkItem.mockResolvedValue({
      workItem: item({ executionState: "failed" }),
      observability: { latestRun: { id: "aur_failed", status: "blocked" } },
    });
    mocks.retryAutoRun.mockRejectedValue(new Error("terminal_capability_grant_missing"));
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "Retry AI work" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("task is unchanged");
    expect(alert.textContent).not.toContain("terminal_capability_grant_missing");
    expect(screen.getByRole("dialog", { name: "Retry AI work?" })).toBeTruthy();
  });

  it("keeps review-ready users in simple details and presents a readable delivery preview", async () => {
    const onOpenExpert = vi.fn();
    mocks.getWorkItem.mockResolvedValue({
      workItem: item({
        status: "review",
        executionState: "completed",
        lastProgressSummary: "The customer update is ready to send.",
        acceptanceResults: [{ criterion: "Customer-ready summary", status: "passed", note: "Reviewed", verificationId: "ver_1" }],
        inputAssets: [{
          id: "input_1", path: ".myagenttool/inputs/lwi_1/brief.txt", originalName: "brief.txt", family: "text", mimeType: "text/plain", terminalId: "local",
          hash: "hash", version: "1", capabilities: [], readiness: { state: "ready", reason: "task_material_claimed" },
        }],
        outputAssets: [{
          id: "asset_1", path: "reports/customer-update.md", family: "markdown", terminalId: "local",
          hash: null, version: null, capabilities: [], readiness: { state: "ready", reason: "ready" },
        }],
      }),
    });
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={onOpenExpert} />);

    const deliveredTitle = await screen.findByText("What AI delivered");
    const decisionTitle = screen.getByText("Make the final decision");
    expect(deliveredTitle.compareDocumentPosition(decisionTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByText("The customer update is ready to send.").length).toBeGreaterThan(0);
    expect(screen.getByText("customer-update.md")).toBeTruthy();
    expect(screen.getByText("1 passed · 0 need review")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Process again with/ })).toBeNull();
    expect(onOpenExpert).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Hide result" }));
    expect(screen.queryByText("What AI delivered")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Review result" }));

    fireEvent.click(screen.getByRole("button", { name: "View full report" }));
    const report = screen.getByRole("dialog", { name: "What AI delivered" });
    expect(within(report).getAllByText("The customer update is ready to send.").length).toBeGreaterThan(0);
    expect(within(report).getByRole("button", { name: "Ask AI to revise" })).toBeTruthy();
    expect(within(report).getByRole("button", { name: "Approve and complete task" })).toBeTruthy();
    fireEvent.click(within(report).getByRole("button", { name: "Ask AI to revise" }));
    expect(within(report).getByPlaceholderText(/Tell AI what to change/)).toBeTruthy();
    fireEvent.click(within(report).getByRole("button", { name: "Cancel revision" }));
    expect(onOpenExpert).not.toHaveBeenCalled();
    fireEvent.click(within(report).getByRole("button", { name: "Open expert details" }));
    expect(onOpenExpert).toHaveBeenCalledWith("report");
  });

  it("shows a report-only AI outcome with the same review experience", async () => {
    mocks.getWorkItem.mockResolvedValue({
      workItem: item({ status: "review", executionState: "verifying", waitingOn: "me" }),
      observability: {
        latestRun: {
          id: "aur_report",
          status: "report_posted",
          phase: "review_ready",
          updatedAt: "2026-08-08T12:49:03.984Z",
          report: "# Article report\n\n## Core result\n\nAI is safer inside a deterministic workflow.",
        },
        outcome: {
          status: "available",
          summary: "AI is safer inside a deterministic workflow.",
          fullReport: "# Article report\n\n## Core result\n\nAI is safer inside a deterministic workflow.",
          highlights: ["Production reliability matters", "AI must degrade safely"],
          warnings: ["The financing figure was not independently verified."],
          files: ["summary/REPORT.md"],
          verification: null,
          deliveredAt: "2026-08-08T12:49:03.984Z",
        },
        outcomeHistory: [{
          version: 1,
          status: "available",
          summary: "The first result lacked source evidence.",
          fullReport: "# First result\n\nThe first result lacked source evidence.",
          highlights: [],
          warnings: [],
          files: [],
          verification: null,
          deliveredAt: "2026-08-08T12:30:00.000Z",
          invocationId: "inv_report_v1",
          supersededAt: "2026-08-08T12:40:00.000Z",
          supersededByFeedback: "Add source evidence.",
        }],
      },
    });
    mocks.retryAutoRun.mockResolvedValue({ autoRun: { id: "aur_report", status: "running" } });
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} />);

    expect(await screen.findByText("Ready for your review")).toBeTruthy();
    expect(screen.queryByText("AI is working")).toBeNull();
    expect(screen.getAllByText("AI is safer inside a deterministic workflow.").length).toBeGreaterThan(0);
    expect(screen.getByText("Production reliability matters")).toBeTruthy();
    expect(screen.getByText("The financing figure was not independently verified.")).toBeTruthy();
    expect(screen.getByText("REPORT.md")).toBeTruthy();
    fireEvent.click(screen.getByText("Previous results (1)"));
    expect(screen.getByText("The first result lacked source evidence.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "View full report" }));
    const report = screen.getByRole("dialog", { name: "What AI delivered" });
    expect(within(report).getByRole("heading", { name: "Article report" })).toBeTruthy();
    expect(within(report).getByRole("button", { name: "Approve and complete task" })).toBeTruthy();
    fireEvent.click(within(report).getByRole("button", { name: "Ask follow-up" }));
    fireEvent.change(within(report).getByPlaceholderText(/What supports the second conclusion/), { target: { value: "Show the source for the second conclusion." } });
    fireEvent.click(within(report).getByRole("button", { name: "Send follow-up" }));
    await waitFor(() => expect(mocks.retryAutoRun).toHaveBeenCalledWith("aur_report", "Show the source for the second conclusion."));
    expect(mocks.startWorkItemAutoRun).not.toHaveBeenCalled();
  });

  it("previews a Markdown deliverable in a modal without leaving the task", async () => {
    mocks.getWorkItem.mockResolvedValue({
      workItem: item({ status: "review", executionState: "completed", waitingOn: "me" }),
      observability: {
        latestRun: { id: "aur_report", status: "report_posted", phase: "review_ready", updatedAt: "2026-08-08T12:49:03.984Z" },
        outcome: {
          status: "available",
          summary: "The report is ready.",
          fullReport: "# Report\n\nThe report is ready.",
          highlights: [], warnings: [], files: ["summary/REPORT.md"],
          fileEntries: [{
            name: "REPORT.md", path: "summary/REPORT.md", projectId: "prj_1", worktreeId: "wtr_1",
            status: "available", preview: "document",
          }],
          verification: null,
          deliveredAt: "2026-08-08T12:49:03.984Z",
        },
      },
    });
    mocks.projectAssetPreview.mockResolvedValue({
      path: "summary/REPORT.md",
      text: "---\ntitle: \"Customer report\"\nauthor: \"Morgan\"\npublished_at: 2026-08-08\nsource_provider: local\n---\nThe report is ready.\n\n![Architecture](assets/diagram.png)",
      size: 140,
      truncated: false,
    });
    mocks.projectAssetPreviewBytes.mockResolvedValue(new ArrayBuffer(8));
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "Browse file: REPORT.md" }));

    await waitFor(() => expect(mocks.projectAssetDescriptor).toHaveBeenCalledWith("prj_1", "summary/REPORT.md", "wtr_1"));
    const preview = await screen.findByRole("dialog", { name: "REPORT.md" });
    expect(within(preview).getByRole("heading", { name: "Customer report" })).toBeTruthy();
    expect(within(preview).getByText(/Author: Morgan/)).toBeTruthy();
    expect(within(preview).getByText("The report is ready.")).toBeTruthy();
    expect(within(preview).getByText("Document images: 1")).toBeTruthy();
    expect(within(preview).getByRole("button", { name: "Show first image" })).toBeTruthy();
    await waitFor(() => expect(mocks.projectAssetPreviewBytes).toHaveBeenCalledWith("prj_1", "summary/assets/diagram.png", "wtr_1"));
    expect(new URLSearchParams(window.location.search).get("document")).toBeNull();
    expect(useUiStore.getState().section).toBe("dashboard");
  });

  it("previews and reveals a managed local-knowledge deliverable without exposing its host path", async () => {
    const contentId = "lc_0123456789abcdef0123456789abcdef";
    mocks.previewLocalContent.mockResolvedValueOnce({
      preview: {
        contentId,
        title: "Saved article",
        kind: "article",
        format: "plain_text",
        text: "# Saved article\n\nThe article is available locally.\n\n![Chart](assets/001-chart.png)",
        truncated: false,
        bytesRead: 90,
        totalBytes: 90,
        mimeType: "text/markdown",
        originalName: "saved-article.md",
        activeContentExecuted: false,
        remoteResourcesLoaded: false,
      },
    });
    mocks.getWorkItem.mockResolvedValue({
      workItem: item({ status: "done", executionState: "completed", waitingOn: "none" }),
      observability: {
        latestRun: null,
        outcome: {
          status: "available",
          summary: "Saved one article to the local library.",
          fullReport: "Saved one article to the local library.",
          highlights: [], warnings: [], files: ["Saved article.md"],
          fileEntries: [{
            name: "Saved article.md", path: null, contentId, projectId: "prj_1", worktreeId: null,
            status: "available", preview: "document",
          }],
          verification: null,
          deliveredAt: "2026-08-20T10:01:34.428Z",
        },
      },
    });
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "View result" }));
    fireEvent.click(await screen.findByRole("button", { name: "Browse file: Saved article.md" }));
    await waitFor(() => expect(mocks.previewLocalContent).toHaveBeenCalledWith(contentId));
    const preview = await screen.findByRole("dialog", { name: "Saved article.md" });
    expect(within(preview).getByRole("heading", { name: "Saved article" })).toBeTruthy();
    expect(within(preview).getByText("The article is available locally.")).toBeTruthy();
    await waitFor(() => expect(mocks.previewLocalContentAsset).toHaveBeenCalledWith(contentId, "assets/001-chart.png"));
    expect(mocks.projectAssetDescriptor).not.toHaveBeenCalled();
    fireEvent.click(within(preview).getByRole("button", { name: "Close" }));

    fireEvent.click(await screen.findByRole("button", { name: "Open containing folder: Saved article.md" }));
    await waitFor(() => expect(mocks.revealLocalContent).toHaveBeenCalledWith(contentId));
    expect(document.body.textContent).not.toContain("Application Support");
  });

  it("reveals a deliverable in its local folder without leaving the task", async () => {
    const revealContainedAsset = vi.fn().mockResolvedValue({ revealed: true });
    window.myagenttoolDesktop = { revealContainedAsset };
    mocks.getWorkItem.mockResolvedValue({
      workItem: item({ status: "review", executionState: "completed", waitingOn: "me" }),
      observability: {
        latestRun: { id: "aur_report", status: "report_posted", phase: "review_ready", updatedAt: "2026-08-08T12:49:03.984Z" },
        outcome: {
          status: "available", summary: "The report is ready.", fullReport: "# Report", highlights: [], warnings: [],
          files: ["deliverables/report.xlsx"],
          fileEntries: [{ name: "report.xlsx", path: "deliverables/report.xlsx", projectId: "prj_1", worktreeId: "wtr_1", status: "available", preview: "document" }],
          verification: null, deliveredAt: "2026-08-08T12:49:03.984Z",
        },
      },
    });
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "Open containing folder: report.xlsx" }));

    await waitFor(() => expect(revealContainedAsset).toHaveBeenCalledWith({
      projectId: "prj_1", worktreeId: "wtr_1", relativePath: "deliverables/report.xlsx",
    }));
    expect(useUiStore.getState().section).toBe("dashboard");
    expect(window.location.search).toBe("?section=dashboard");
  });

  it("reveals a deliverable through the local server when the page is open in a browser", async () => {
    mocks.revealProjectAsset.mockResolvedValue({ revealed: true, path: "deliverables/report.xlsx" });
    mocks.getWorkItem.mockResolvedValue({
      workItem: item({ status: "review", executionState: "completed", waitingOn: "me" }),
      observability: {
        latestRun: { id: "aur_report", status: "report_posted", phase: "review_ready", updatedAt: "2026-08-08T12:49:03.984Z" },
        outcome: {
          status: "available", summary: "The report is ready.", fullReport: "# Report", highlights: [], warnings: [],
          files: ["deliverables/report.xlsx"],
          fileEntries: [{ name: "report.xlsx", path: "deliverables/report.xlsx", projectId: "prj_1", worktreeId: "wtr_1", status: "available", preview: "document" }],
          verification: null, deliveredAt: "2026-08-08T12:49:03.984Z",
        },
      },
    });
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "Open containing folder: report.xlsx" }));

    await waitFor(() => expect(mocks.revealProjectAsset).toHaveBeenCalledWith("prj_1", "deliverables/report.xlsx", "wtr_1"));
    expect(useUiStore.getState().section).toBe("dashboard");
  });

  it("previews source and configuration deliveries with wrapping in the same modal", async () => {
    mocks.getWorkItem.mockResolvedValue({
      workItem: item({ status: "review", executionState: "completed", waitingOn: "me" }),
      observability: {
        latestRun: { id: "aur_code", status: "report_posted", phase: "review_ready", updatedAt: "2026-08-08T12:49:03.984Z" },
        outcome: {
          status: "available", summary: "The configuration is ready.", fullReport: "# Result", highlights: [], warnings: [],
          files: ["config/release.json"],
          fileEntries: [{ name: "release.json", path: "config/release.json", projectId: "prj_1", worktreeId: "wtr_1", status: "available", preview: "unsupported" }],
          verification: null, deliveredAt: "2026-08-08T12:49:03.984Z",
        },
      },
    });
    mocks.readWorktreeFile.mockResolvedValue({ content: '{"enabled":true,"channels":["stable"]}', truncated: false });
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "Browse file: release.json" }));

    await waitFor(() => expect(mocks.projectAssetDescriptor).toHaveBeenCalledWith("prj_1", "config/release.json", "wtr_1"));
    const preview = await screen.findByRole("dialog", { name: "release.json" });
    expect(within(preview).getByText(/"enabled": true/)).toBeTruthy();
    expect(useUiStore.getState().section).toBe("dashboard");
    expect(window.location.search).toBe("?section=dashboard");
  });

  it("keeps review actions usable when a deliverable moved", async () => {
    mocks.projectAssetDescriptor.mockRejectedValue(new Error("not found"));
    mocks.getWorkItem.mockResolvedValue({
      workItem: item({ status: "review", executionState: "completed", waitingOn: "me" }),
      observability: {
        latestRun: { id: "aur_report", status: "report_posted", phase: "review_ready", updatedAt: "2026-08-08T12:49:03.984Z" },
        outcome: {
          status: "available", summary: "The report is ready.", fullReport: "# Report", highlights: [], warnings: [],
          files: ["summary/REPORT.md"],
          fileEntries: [{ name: "REPORT.md", path: "summary/REPORT.md", projectId: "prj_1", worktreeId: "wtr_1", status: "available", preview: "document" }],
          verification: null, deliveredAt: "2026-08-08T12:49:03.984Z",
        },
      },
    });
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "Browse file: REPORT.md" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/keep reviewing or try again/i);
    expect(useUiStore.getState().section).toBe("dashboard");
    expect(screen.getByRole("button", { name: "Approve and complete task" })).toBeTruthy();
  });

  it("prepares and confirms the execution contract before handing the task to AI", async () => {
    const unplanned = item({
      status: "backlog",
      executionState: "unclaimed",
      plannedDate: null,
      acceptanceCriteria: [],
      verificationSop: [],
      executionContractGate: { ready: false, missing: ["acceptance_criteria", "verification_sop", "confirmation"], source: null, confirmedAt: null },
    });
    mocks.getWorkItem.mockResolvedValue({ workItem: unplanned });
    mocks.suggestWorkItemDraft.mockResolvedValue({
      draft: {
        acceptanceCriteria: ["Customer-ready summary"],
        verificationSop: ["Review the customer-facing result"],
        templateMatch: {
          state: "matched",
          candidates: [],
          selected: {
            definitionId: "rtd_update",
            templateId: "family_update",
            version: 3,
            reasons: ["Expected result matches customer update"],
          },
        },
      },
    });
    const prepared = item({
      status: "backlog", executionState: "unclaimed", plannedDate: null,
      executionContractSource: "assisted", executionContractConfirmedAt: "2026-08-05T00:01:00.000Z",
      executionContractGate: { ready: true, missing: [], source: "assisted", confirmedAt: "2026-08-05T00:01:00.000Z" },
      revision: 3,
    });
    mocks.updateWorkItem
      .mockResolvedValueOnce({ workItem: prepared })
      .mockResolvedValueOnce({ workItem: item({ status: "ready", executionPolicy: "auto", waitingOn: "ai", revision: 4 }) });
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "Let AI start" }));
    await waitFor(() => expect(mocks.updateWorkItem).toHaveBeenCalledWith("lwi_1", {
      expectedRevision: unplanned.revision,
      acceptanceCriteria: ["Customer-ready summary"],
      verificationSop: ["Review the customer-facing result"],
      myTemplateBinding: {
        definitionId: "rtd_update",
        familyId: "family_update",
        version: 3,
        matchReasons: ["Expected result matches customer update"],
      },
    }));
    expect(await screen.findByText(/execution plan is ready/i)).toBeTruthy();
    expect(mocks.updateWorkItem).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Let AI start" }));
    await waitFor(() => expect(mocks.updateWorkItem).toHaveBeenCalledWith("lwi_1", expect.objectContaining({
      expectedRevision: prepared.revision,
      executionPolicy: "auto",
      waitingOn: "ai",
      status: "ready",
    })));
    expect(mocks.suggestWorkItemDraft).toHaveBeenCalledTimes(1);
    expect(mocks.startWorkItemAutoRun).not.toHaveBeenCalled();
    expect(await screen.findByText(/set to automatic/i)).toBeTruthy();
  });

  it("asks an existing local Issue for its desired result instead of exposing template choices", async () => {
    const unplanned = item({
      status: "backlog",
      executionState: "unclaimed",
      plannedDate: null,
      acceptanceCriteria: [],
      verificationSop: [],
      executionContractGate: { ready: false, missing: ["acceptance_criteria", "verification_sop", "confirmation"], source: null, confirmedAt: null },
    });
    mocks.getWorkItem.mockResolvedValue({ workItem: unplanned });
    mocks.suggestWorkItemDraft.mockResolvedValue({
      draft: {
        acceptanceCriteria: ["The selected result is complete"],
        verificationSop: ["Open and verify the selected result"],
        templateMatch: {
          state: "ambiguous",
          selected: null,
          clarification: { reason: "learned_preference_conflict" },
          candidates: [
            {
              templateId: "family_quote", definitionId: "rtd_quote", version: 2,
              name: "Customer quotation", expectedOutput: "Quotation workbook",
              reasons: ["The inquiry may produce a quotation"],
            },
            {
              templateId: "family_summary", definitionId: "rtd_summary", version: 1,
              name: "Inquiry summary", expectedOutput: "Inquiry summary",
              reasons: ["The inquiry may produce a summary"],
            },
          ],
        },
      },
    });
    mocks.updateWorkItem.mockResolvedValue({
      workItem: item({
        revision: 3,
        acceptanceCriteria: ["The selected result is complete"],
        verificationSop: ["Open and verify the selected result"],
      }),
    });
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "Let AI start" }));
    expect(await screen.findByRole("region", { name: "What result do you want this time?" })).toBeTruthy();
    expect(screen.getAllByText(/previously chose different results/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/system does not guess/).length).toBeGreaterThan(0);
    expect(mocks.updateWorkItem).not.toHaveBeenCalled();
    expect(screen.queryByRole("combobox", { name: /template/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Quotation workbook" }));
    await waitFor(() => expect(mocks.updateWorkItem).toHaveBeenCalledWith("lwi_1", expect.objectContaining({
      acceptanceCriteria: ["The selected result is complete"],
      verificationSop: ["Open and verify the selected result"],
      myTemplateBinding: expect.objectContaining({
        definitionId: "rtd_quote",
        familyId: "family_quote",
        version: 2,
        userConfirmedResult: true,
      }),
    })));
  });

  it("answers an executor question from the task and resumes the same run", async () => {
    mocks.getWorkItem.mockResolvedValue({
      workItem: item({ executionState: "awaiting_approval", waitingOn: "me" }),
      observability: {
        latestRun: {
          id: "aur_clarify",
          status: "needs_input",
          phase: "waiting_for_input",
          updatedAt: "2026-08-07T01:00:00.000Z",
          decision: {
            path: "office",
            decidedBy: "agent",
            confidence: 0.8,
            clarifyingQuestions: ["Should an invalid timezone fall back to UTC or stop scheduling?"],
            suggestedActions: [{ id: "utc", label: "Fall back to UTC", description: "Fall back to UTC and record a warning." }],
          },
        },
      },
    });
    mocks.answerClarify.mockResolvedValue({ ok: true, resumed: true });
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} />);

    expect(await screen.findByText("AI needs your decision before continuing")).toBeTruthy();
    expect(screen.getByText(/AI needs your answer: Should an invalid timezone/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Answer AI" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use suggestion: Fall back to UTC" }));
    expect((screen.getByPlaceholderText(/Answer the questions above/) as HTMLTextAreaElement).value).toBe("Fall back to UTC and record a warning.");
    fireEvent.change(screen.getByPlaceholderText(/Answer the questions above/), { target: { value: "Fall back to UTC and record a warning." } });
    fireEvent.click(screen.getByRole("button", { name: "Submit and continue" }));

    await waitFor(() => expect(mocks.answerClarify).toHaveBeenCalledWith("aur_clarify", {
      answers: "Fall back to UTC and record a warning.",
    }));
    expect(await screen.findByText(/continue in the same task run/i)).toBeTruthy();
  });

  it("names the prerequisite and opens it directly instead of showing technical blocker details", async () => {
    const onOpenWorkItem = vi.fn();
    mocks.getWorkItem.mockResolvedValue({
      workItem: item({
        status: "blocked",
        executionState: "unclaimed",
        waitingOn: "internal",
        blockedBy: [{
          id: "lwi_foundation",
          localRef: "LOCAL-7",
          title: "Finish the data model",
          status: "in_progress",
          state: "open",
          resolved: false,
        }],
      }),
    });
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} onOpenWorkItem={onOpenWorkItem} />);

    expect(await screen.findByText("Waiting for LOCAL-7 · Finish the data model to finish.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "View prerequisite" }));
    expect(onOpenWorkItem).toHaveBeenCalledWith("lwi_foundation");
  });

  it("lets the user stop an AI run while it is waiting for clarification", async () => {
    mocks.getWorkItem.mockResolvedValue({
      workItem: item({ executionState: "awaiting_approval", waitingOn: "me" }),
      observability: {
        latestRun: {
          id: "aur_clarify_stop",
          status: "needs_input",
          phase: "waiting_for_input",
          updatedAt: "2026-08-07T01:00:00.000Z",
          decision: {
            path: "clarify",
            decidedBy: "agent",
            confidence: 0.8,
            clarifyingQuestions: ["Which behavior should be used?"],
          },
        },
      },
    });
    mocks.cancelAutoRun.mockResolvedValue({ id: "aur_clarify_stop", status: "cancelled" });
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "Stop AI" }));

    await waitFor(() => expect(mocks.cancelAutoRun).toHaveBeenCalledWith("aur_clarify_stop"));
    expect(await screen.findByText(/AI run was stopped/i)).toBeTruthy();
  });

  it("explains project context as planning input rather than completion evidence", async () => {
    mocks.getWorkItem.mockResolvedValue({
      workItem: item(),
      observability: {
        latestRun: {
          id: "aur_context",
          status: "running",
          phase: "understanding",
          updatedAt: "2026-08-07T01:00:00.000Z",
          understandingContext: {
            version: "work-item-understanding-context-v1",
            digest: "a".repeat(64),
            documentPaths: ["README.md", "AGENTS.md"],
            relatedFiles: [{ path: "src/schedule.mjs", line: 12, term: "timezone" }],
            similarTasks: [{ localRef: "LOCAL-59", title: "Persist timezone", score: 0.5 }],
            verificationCommand: ["pnpm", "test"],
            truncated: true,
            redactions: 1,
          },
        },
      },
    });

    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} />);

    expect(await screen.findByRole("region", { name: "Context AI used to understand the task" })).toBeTruthy();
    expect(screen.getByText("README.md, AGENTS.md")).toBeTruthy();
    expect(screen.getByText("1 relevant locations · 1 similar tasks")).toBeTruthy();
    expect(screen.getByText("pnpm test")).toBeTruthy();
    expect(screen.getByText(/does not mean the task is complete or accepted/i)).toBeTruthy();
    expect(screen.getByText(/1 possible credentials were hidden/i)).toBeTruthy();
  });

  it("does not invent acceptance criteria during review and blocks approval for a legacy run without a contract", async () => {
    const withoutCriteria = item({
      status: "review",
      executionState: "completed",
      acceptanceCriteria: [],
      verificationSop: [],
      executionContractSource: null,
      executionContractConfirmedAt: null,
      executionContractGate: {
        ready: false,
        missing: ["acceptance_criteria", "verification_sop", "confirmation"],
        source: null,
        confirmedAt: null,
      },
    });
    mocks.getWorkItem.mockResolvedValue({ workItem: withoutCriteria });
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} />);

    expect(await screen.findByText(/no pre-confirmed completion requirements/i)).toBeTruthy();
    expect(screen.queryByText(/AI-suggested completion criteria/i)).toBeNull();
    expect(screen.getByText("Add before handing to AI")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Approve and complete task" }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.updateWorkItem).not.toHaveBeenCalled();
  });

  it("shows the Codex delivery verdict and sends review findings back to the same run", async () => {
    mocks.getWorkItem.mockResolvedValue({
      workItem: item({ status: "review", executionState: "completed" }),
      observability: {
        latestRun: { id: "aur_60", status: "done" },
        delivery: {
          state: "awaiting_review",
          mode: "local_merge",
          worktreeId: "wtr_60",
          branchName: "local-60-timezone",
          remoteUrl: null,
          report: {
            summary: "Propagated the terminal timezone through local scheduling.",
            verification: { passed: true, verified: true, summary: "Server regression tests passed." },
            changedFiles: ["apps/server/src/routes/agents.mjs"],
            completedAt: "2026-08-07T08:00:00.000Z",
          },
          aiReview: {
            status: "completed",
            invocationId: "inv_review_60",
            reviewer: "codex",
            startedAt: "2026-08-07T08:00:00.000Z",
            completedAt: "2026-08-07T08:01:00.000Z",
            verdict: "changes_requested",
            summary: "The new timezone is not persisted after registration.",
            findings: [],
            reviewedCommit: "abc123",
            errorCode: null,
          },
          review: {
            verdict: "changes_requested",
            summary: "The new timezone is not persisted after registration.",
            comments: [{
              path: "apps/server/src/routes/agents.mjs",
              line: 170,
              severity: "high",
              body: "The registration path updates memory but does not schedule persistence.",
              suggestion: "Call persistStateSoon after the timezone changes.",
            }],
            reviewedCommit: "abc123",
            reviewedBy: "usr_autorun_review",
            source: "ai",
            reviewerName: "Codex",
            reviewInvocationId: "inv_review_60",
            createdAt: "2026-08-07T08:01:00.000Z",
          },
        },
      },
    });
    mocks.createWorkItemComment.mockResolvedValue({ comment: { id: "comment_review_60" } });
    mocks.retryAutoRun.mockResolvedValue({ autoRun: { id: "aur_60", status: "running" } });
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} />);

    expect(await screen.findByText("Codex review conclusion")).toBeTruthy();
    expect(screen.getAllByText("The new timezone is not persisted after registration.").length).toBeGreaterThan(0);
    expect(screen.getByText("apps/server/src/routes/agents.mjs:170")).toBeTruthy();
    expect(screen.getAllByText("Propagated the terminal timezone through local scheduling.").length).toBeGreaterThan(0);
    expect(screen.getByText("Server regression tests passed.")).toBeTruthy();
    expect(screen.getByText("Do not accept this result yet")).toBeTruthy();
    expect(screen.getByText("Result risk: High")).toBeTruthy();
    expect(screen.getAllByText(/1 product file/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Keep the current result and history without applying it/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/another AI run may take time and incur cost/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Apply this 1-file delivery to the local base branch/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Send back to AI" }));
    await waitFor(() => expect(mocks.retryAutoRun).toHaveBeenCalledWith(
      "aur_60",
      expect.stringContaining("updates memory but does not schedule persistence"),
    ));
    expect(mocks.startWorkItemAutoRun).not.toHaveBeenCalled();
  });

  it("explains a safe reviewed delivery and the real effect of confirming it", async () => {
    mocks.getWorkItem.mockResolvedValue({
      workItem: item({ status: "review", executionState: "completed" }),
      observability: {
        latestRun: { id: "aur_approved", status: "done" },
        delivery: {
          state: "awaiting_review",
          mode: "pull_request",
          worktreeId: "wtr_approved",
          branchName: "local-approved",
          remoteUrl: null,
          report: {
            summary: "Implemented the requested behavior.",
            verification: { passed: true, verified: true, summary: "Relevant tests passed." },
            changedFiles: ["apps/server/src/feature.mjs", "apps/server/test/feature.test.mjs", "docs/feature.md"],
            completedAt: "2026-08-07T08:00:00.000Z",
          },
          aiReview: {
            status: "completed", invocationId: "inv_approved", reviewer: "codex",
            startedAt: "2026-08-07T08:00:00.000Z", completedAt: "2026-08-07T08:01:00.000Z",
            verdict: "approved", summary: "No actionable regressions found.", findings: [],
            reviewedCommit: "abc123", errorCode: null,
          },
          review: {
            verdict: "approved", summary: "No actionable regressions found.", comments: [],
            reviewedCommit: "abc123", reviewedBy: "usr_autorun_review", source: "ai",
            reviewerName: "Codex", reviewInvocationId: "inv_approved", createdAt: "2026-08-07T08:01:00.000Z",
          },
        },
      },
    });
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} />);

    expect(await screen.findByText("Result passed automated review and verification")).toBeTruthy();
    expect(screen.getByText("Result risk: Low")).toBeTruthy();
    expect(screen.getAllByText(/1 product file, 1 test file, 1 documentation or configuration file/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Create a pull request for later merge/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/remote base branch is not changed directly/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Approve and create pull request" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "View full report" }));
    const report = screen.getByRole("dialog", { name: "What AI delivered" });
    expect(within(report).getByText("Available actions and impact")).toBeTruthy();
    expect(within(report).getByText("AI's original delivery note (may contain technical terms)")).toBeTruthy();
    expect(within(report).getByRole("button", { name: "Open expert details" })).toBeTruthy();
    fireEvent.click(within(report).getByRole("button", { name: "Approve and create pull request" }));
    expect(screen.queryByRole("dialog", { name: "What AI delivered" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Approve and create a pull request?" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create pull request" })).toBeTruthy();
  });

  it("offers a material-specific rerun only when a change is waiting for the next execution", async () => {
    mocks.getWorkItem.mockResolvedValue({
      workItem: item({
        status: "review",
        executionState: "completed",
        materialChangesPending: true,
        inputAssets: [{
          id: "input_1", path: ".myagenttool/inputs/lwi_1/brief.txt", originalName: "brief.txt", family: "text", mimeType: "text/plain", terminalId: "local",
          hash: "hash", version: "1", capabilities: [], readiness: { state: "ready", reason: "task_material_claimed" },
        }],
      }),
    });
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} />);

    expect(await screen.findByRole("button", { name: "Process again with updated material" })).toBeTruthy();
  });

  it("records requested changes and sends the same tracked task back to AI", async () => {
    mocks.getWorkItem.mockResolvedValue({
      workItem: item({ status: "review", executionState: "completed" }),
    });
    mocks.createWorkItemComment.mockResolvedValue({ comment: { id: "comment_change" } });
    mocks.startWorkItemAutoRun.mockResolvedValue({ autoRun: { id: "aur_revision", status: "materializing" } });
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "Ask AI to revise" }));
    fireEvent.change(screen.getByPlaceholderText(/Tell AI what to change/), {
      target: { value: "Add the missing customer risks." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send changes to AI" }));

    await waitFor(() => expect(mocks.createWorkItemComment).toHaveBeenCalledWith("lwi_1", "Add the missing customer risks."));
    expect(mocks.startWorkItemAutoRun).toHaveBeenCalledWith("lwi_1");
    expect(await screen.findByText(/AI has started another pass/)).toBeTruthy();
  });

  it("accepts the result, records completion criteria, and closes the task", async () => {
    const reviewItem = item({ status: "review", executionState: "completed", acceptanceResults: [] });
    const verifiedItem = { ...reviewItem, revision: 3, acceptanceResults: [{ criterion: "Customer-ready summary", status: "passed" as const, note: "Accepted by user", verificationId: "ver_1" }] };
    const completedItem = { ...verifiedItem, revision: 4, status: "done" as const, state: "closed" as const };
    mocks.getWorkItem.mockResolvedValue({ workItem: reviewItem });
    mocks.recordWorkItemVerification.mockResolvedValue({ workItem: verifiedItem });
    mocks.transitionWorkItem.mockResolvedValue({ workItem: completedItem });
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "Approve and complete task" }));
    const dialog = screen.getByRole("dialog", { name: "Confirm this result and complete the task?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm and complete" }));

    await waitFor(() => expect(mocks.recordWorkItemVerification).toHaveBeenCalledWith("lwi_1", expect.objectContaining({
      expectedRevision: 2,
      status: "passed",
    })));
    expect(mocks.transitionWorkItem).toHaveBeenCalledWith("lwi_1", "close", 3);
    expect(await screen.findByText("This work is complete")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Hide result" })).toHaveLength(1);
    expect(screen.queryByText("Current progress")).toBeNull();
    expect(screen.getByText("Completed")).toBeTruthy();
  });

  it("asks before external writeback and closes GitLab only after local completion", async () => {
    const reviewItem = item({
      status: "review", executionState: "completed",
      acceptanceResults: [{ criterion: "Customer-ready summary", status: "passed", note: "Ready", verificationId: "ver_1" }],
      externalBindings: [{
        kind: "gitlab_issue", provider: "gitlab", number: 19, url: "https://gitlab.example/acme/repo/-/issues/19",
        lastSyncedAt: "2026-08-05T00:00:00.000Z", relation: "source", isPrimary: true, syncPolicy: "manual", conflict: null,
      }],
    });
    const completedItem = { ...reviewItem, revision: 3, status: "done" as const, state: "closed" as const };
    mocks.getWorkItem.mockResolvedValue({ workItem: reviewItem });
    mocks.transitionWorkItem.mockResolvedValue({ workItem: completedItem });
    mocks.syncWorkItemExternalIssue.mockResolvedValue({ workItem: completedItem });
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} />);

    const currentProgress = await screen.findByText("Current progress");
    const deliveryResult = screen.getByText("What AI delivered");
    const collaboration = screen.getByText("Collaboration handoff");
    const externalSource = screen.getByText("External issue source");
    expect(currentProgress.compareDocumentPosition(deliveryResult) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(deliveryResult.compareDocumentPosition(collaboration) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(collaboration.compareDocumentPosition(externalSource) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: "Approve and complete task" }));
    const dialog = screen.getByRole("dialog", { name: "Confirm this result and complete the task?" });
    expect(within(dialog).getByRole("radio", { name: /Complete the local task only/ })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("radio", { name: /Complete locally and write back/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm and complete" }));

    await waitFor(() => expect(mocks.transitionWorkItem).toHaveBeenCalledWith("lwi_1", "close", 2));
    expect(mocks.syncWorkItemExternalIssue).toHaveBeenCalledWith("lwi_1", "gitlab", { expectedRevision: 3, direction: "push" });
  });

  it("keeps local completion when external writeback fails and gives a retry path", async () => {
    const reviewItem = item({
      status: "review", executionState: "completed",
      acceptanceResults: [{ criterion: "Customer-ready summary", status: "passed", note: "Ready", verificationId: "ver_1" }],
      externalBindings: [{ kind: "github_issue", provider: "github", number: 27, url: null, lastSyncedAt: "2026-08-05T00:00:00.000Z", conflict: null }],
    });
    const completedItem = { ...reviewItem, revision: 3, status: "done" as const, state: "closed" as const };
    mocks.getWorkItem.mockResolvedValue({ workItem: reviewItem });
    mocks.transitionWorkItem.mockResolvedValue({ workItem: completedItem });
    mocks.syncWorkItemGithubIssue.mockRejectedValue(new Error("provider offline"));
    const onOpenExpert = vi.fn();
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={onOpenExpert} />);

    fireEvent.click(await screen.findByRole("button", { name: "Approve and complete task" }));
    fireEvent.click(screen.getByRole("radio", { name: /Complete locally and write back/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm and complete" }));

    expect(await screen.findByText(/local task is complete, but external writeback failed/i)).toBeTruthy();
    expect(screen.getByText("This work is complete")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Manage sync" }));
    expect(onOpenExpert).toHaveBeenCalledWith("trace");
  });

  it("posts a comment without leaving the simple detail", async () => {
    mocks.getWorkItem.mockResolvedValue({ workItem: item() });
    mocks.createWorkItemComment.mockResolvedValue({ comment: { id: "comment_1" } });
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: /Comments/ }));
    const input = await screen.findByPlaceholderText(/Add context/);
    fireEvent.change(input, { target: { value: "Customer approved the wording." } });
    fireEvent.click(screen.getByRole("button", { name: "Post comment" }));
    await waitFor(() => expect(mocks.createWorkItemComment).toHaveBeenCalledWith("lwi_1", "Customer approved the wording."));
    expect(screen.getByRole("status").textContent).toContain("collaboration record is up to date");
  });

  it("lets an ordinary user reopen a completed task from the reference-file section", async () => {
    const completed = item({ state: "closed", status: "done", executionState: "completed", revision: 4 });
    const reopened = item({ state: "open", status: "backlog", executionState: "unclaimed", revision: 5 });
    mocks.getWorkItem.mockResolvedValue({ workItem: completed });
    mocks.transitionWorkItem.mockResolvedValue({ workItem: reopened });
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} />);

    expect(await screen.findAllByRole("button", { name: "View result" })).toHaveLength(1);
    fireEvent.click(await screen.findByRole("button", { name: "Reopen task" }));
    const dialog = screen.getByRole("dialog", { name: "Reopen this task to change its materials?" });
    expect(dialog.textContent).toContain("Existing results and history stay available");
    fireEvent.click(within(dialog).getByRole("button", { name: "Reopen task" }));
    await waitFor(() => expect(mocks.transitionWorkItem).toHaveBeenCalledWith("lwi_1", "reopen", 4));
    expect(await screen.findByText("Task reopened. You can now change reference files.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add reference files" })).toBeTruthy();
  });

  it("explains the handoff between My tasks and AI tasks and flags a date conflict", async () => {
    mocks.getWorkItem.mockResolvedValue({
      workItem: item({ dueDate: "2026-08-04", plannedDate: "2026-08-05", executionState: "running" }),
    });
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} />);

    expect(await screen.findByText("Collaboration handoff")).toBeTruthy();
    expect(screen.getByText(/Both views represent this same task/)).toBeTruthy();
    expect(screen.getByTestId("work-item-collaboration-path").textContent).toContain("My plan");
    expect(screen.getByTestId("work-item-collaboration-path").textContent).toContain("AI execution");
    expect(screen.getByTestId("work-item-collaboration-path").textContent).toContain("AI review and my confirmation");
    expect(screen.getByRole("alert").textContent).toContain("scheduled after the expected completion date");
  });

  it("refreshes both Home boards and confirms synchronization after saving progress", async () => {
    const saved = item({ revision: 3, waitingOn: "requester", lastProgressSummary: "Draft sent to the customer." });
    mocks.getWorkItem.mockResolvedValue({ workItem: item() });
    mocks.recordWorkItemProgress.mockResolvedValue({ workItem: saved });
    const stateChanged = vi.fn();
    window.addEventListener("myagenttool:state-change", stateChanged);
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "Update progress" }));
    fireEvent.change(await screen.findByPlaceholderText(/What changed/), { target: { value: "Draft sent to the customer." } });
    fireEvent.click(screen.getByRole("button", { name: "Save progress" }));

    await waitFor(() => expect(mocks.recordWorkItemProgress).toHaveBeenCalled());
    expect(await screen.findByText("Progress saved. My tasks and AI tasks are now in sync.")).toBeTruthy();
    expect(stateChanged).toHaveBeenCalledTimes(1);
    window.removeEventListener("myagenttool:state-change", stateChanged);
  });
});
