import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkflowMemoryView } from "@/features/workflow-memory/workflow-memory-view";
import { i18n } from "@/lib/i18n";

const mocks = vi.hoisted(() => ({
  api: {
    listWorkflowSources: vi.fn(),
    createWorkflowSource: vi.fn(),
    scanWorkflowSource: vi.fn(),
    cancelWorkflowSourceScan: vi.fn(),
    revokeWorkflowSource: vi.fn(),
    deleteWorkflowSourceLearning: vi.fn(),
    listWorkflowArtifacts: vi.fn(),
    confirmWorkflowArtifact: vi.fn(),
    retryWorkflowArtifactExtraction: vi.fn(),
    setWorkflowArtifactExclusion: vi.fn(),
    listBusinessRoutineCandidates: vi.fn(),
    listBusinessRoutineDefinitions: vi.fn(),
    createBusinessRoutineDraft: vi.fn(),
    updateBusinessRoutineDefinition: vi.fn(),
    publishBusinessRoutineDefinition: vi.fn(),
    createBusinessRoutineDefinitionVersion: vi.fn(),
    disableBusinessRoutineDefinition: vi.fn(),
    workflowPairProposals: vi.fn(),
    listDeliveryCases: vi.fn(),
    createDeliveryCase: vi.fn(),
    changeDeliveryCaseState: vi.fn(),
    listWorkflowProfiles: vi.fn(),
    deriveWorkflowProfile: vi.fn(),
    reviseWorkflowProfile: vi.fn(),
    listWorkflowProfileDrafts: vi.fn(),
    createWorkflowProfileDraft: vi.fn(),
    publishWorkflowProfileDraft: vi.fn(),
    listWorkflowInbox: vi.fn(),
    matchWorkflowProfiles: vi.fn(),
    evaluateWorkflowRetrieval: vi.fn(),
    indexWorkflowSourceEmbeddings: vi.fn(),
    inspectWorkflowRequirement: vi.fn(),
    listWorkflowRuns: vi.fn(),
    createWorkflowRun: vi.fn(),
    executeWorkflowRun: vi.fn(),
    cancelWorkflowRunExecution: vi.fn(),
    retryWorkflowRunExecution: vi.fn(),
    cleanupWorkflowRunAttemptWorktree: vi.fn(),
    selectWorkflowRunAttempt: vi.fn(),
    worktreeDiff: vi.fn(),
    validateWorkflowRun: vi.fn(),
    recordWorkflowRunFeedback: vi.fn(),
    previewWorkflowRunPublication: vi.fn(),
    publishWorkflowRunOutputs: vi.fn(),
    bindProject: vi.fn(),
  },
  setSection: vi.fn(),
  setSelectedWorkItemId: vi.fn(),
  setSelectedWorktreeId: vi.fn(),
}));

vi.mock("@/data/use-console-actions", () => ({ api: mocks.api }));
vi.mock("@/features/workflow-memory/workflow-memory-api", () => ({ workflowMemoryApi: mocks.api }));
vi.mock("@/data/use-console-state", () => ({
  useConsoleState: () => ({
    data: {
      currentProjectId: "project-1",
      projects: [{
        id: "project-1",
        name: "Client work",
        status: "active",
        path: "/work/client",
        defaultAgentId: "agent-1",
      }],
      agents: [{
        id: "agent-1",
        name: "Local Codex",
        status: "active",
        health: { status: "healthy" },
      }],
    },
  }),
  useRefreshConsoleState: () => vi.fn(),
}));
vi.mock("@/store/ui-store", () => ({
  useUiStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    setSection: mocks.setSection,
    setSelectedWorkItemId: mocks.setSelectedWorkItemId,
    setSelectedWorktreeId: mocks.setSelectedWorktreeId,
  }),
}));

const source = {
  id: "source-1",
  projectId: "project-1",
  name: "Historical delivery",
  relativePath: "history",
  readMode: "supported_text",
  state: "active",
  scanState: "idle",
  fileCount: 3,
  skippedCount: 1,
  lastScanAt: "2026-07-28T12:00:00.000Z",
  truncated: false,
  revision: 1,
};

const requirement = {
  id: "req-new",
  sourceId: "source-1",
  name: "new-requirement.md",
  relativePath: "history/new-requirement.md",
  extension: "md",
  role: "requirement",
  roleInference: { confidence: 0.96, reasons: ["filename:requirement"] },
  confirmationState: "unconfirmed",
  revision: 1,
};

const profile = {
  id: "profile-1",
  familyId: "family-1",
  sourceId: "source-1",
  name: "Article delivery",
  state: "established",
  profileVersion: 2,
  evidenceCaseIds: ["case-1", "case-2", "case-3"],
  learningQuality: {
    version: 1,
    score: 0.92,
    status: "trusted",
    totalCaseCount: 3,
    trustedCaseCount: 3,
    reviewCaseCount: 0,
    blockedCaseCount: 0,
    blockers: [],
    warnings: [],
  },
  requirementSpec: {
    fields: [{ key: "acceptance_criteria", label: "Acceptance criteria", required: true }],
  },
  outcomeSpec: {
    outputs: [{ family: "document", extension: "md", requiredSections: ["Solution"] }],
    pathTemplate: "deliveries/{date}/{requirement_slug}.md",
    overwritePolicy: "never",
  },
  transformationMap: [],
  taskRecipe: { steps: [] },
  revision: 1,
};

function renderView() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <WorkflowMemoryView />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("en-US");
  window.myagenttoolDesktop = undefined;
  window.history.replaceState({}, "", window.location.pathname);
  Object.values(mocks.api).forEach((mock) => mock.mockReset());
  mocks.setSection.mockReset();
  mocks.setSelectedWorkItemId.mockReset();
  mocks.setSelectedWorktreeId.mockReset();

  mocks.api.listWorkflowSources.mockResolvedValue({ sources: [source] });
  mocks.api.listWorkflowArtifacts.mockResolvedValue({ artifacts: [requirement] });
  mocks.api.workflowPairProposals.mockResolvedValue({ proposals: [] });
  mocks.api.listDeliveryCases.mockResolvedValue({ cases: [] });
  mocks.api.listWorkflowProfiles.mockResolvedValue({ profiles: [profile] });
  mocks.api.listWorkflowProfileDrafts.mockResolvedValue({ drafts: [] });
  mocks.api.listBusinessRoutineCandidates.mockResolvedValue({ candidates: [], count: 0 });
  mocks.api.listBusinessRoutineDefinitions.mockResolvedValue({ routineDefinitions: [], count: 0 });
  mocks.api.listWorkflowInbox.mockResolvedValue({ artifacts: [requirement] });
  mocks.api.listWorkflowRuns.mockResolvedValue({ runs: [] });
  mocks.api.evaluateWorkflowRetrieval.mockResolvedValue({
    sourceId: source.id,
    retrieval: {
      version: 2,
      mode: "structured_lexical",
      vector: { state: "not_configured", used: false },
      deterministicFallback: true,
    },
    current: { sampleCount: 3, top1: 0.667, top5: 1, mrr: 0.778, noResultRate: 0 },
    baseline: { sampleCount: 3, top1: 0.667, top5: 1, mrr: 0.778, noResultRate: 0 },
    gate: { status: "passed", minimumSamples: 3, embeddingEligible: true },
    samples: [],
  });
  mocks.api.matchWorkflowProfiles.mockResolvedValue({
    matches: [{ profile, score: 0.91, reasons: ["same_source", "established_profile"] }],
    similarCases: [],
  });
  mocks.api.inspectWorkflowRequirement.mockResolvedValue({
    artifactId: requirement.id,
    profileId: profile.id,
    executionReady: false,
    pathTemplate: profile.outcomeSpec.pathTemplate,
    plannedOutputs: profile.outcomeSpec.outputs,
    fields: [{
      key: "acceptance_criteria",
      label: "Acceptance criteria",
      required: true,
      status: "missing",
      value: null,
    }],
    missingFields: [{ key: "acceptance_criteria", label: "Acceptance criteria" }],
    blockers: [],
  });
  mocks.api.createWorkflowRun.mockResolvedValue({ run: { id: "run-1" }, idempotentReplay: false });
  mocks.api.worktreeDiff.mockResolvedValue({
    files: [],
    base: "HEAD",
    diff: "",
    truncated: false,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WorkflowMemoryView", () => {
  it("shows the task's authorized folder as a local path without an authorized-source dropdown", async () => {
    window.myagenttoolDesktop = { pickWorkflowSourceFolder: vi.fn().mockResolvedValue(null) };
    const otherSource = {
      ...source,
      id: "source-2",
      name: "Sales history",
      relativePath: "sales-history",
    };
    mocks.api.listWorkflowSources.mockResolvedValue({ sources: [source, otherSource] });
    window.history.replaceState({}, "", `${window.location.pathname}?section=workflowMemory&sourceId=source-2`);

    renderView();

    expect(await screen.findByText("/work/client/sales-history")).toBeTruthy();
    expect(screen.getAllByText("Sales history").length).toBeGreaterThan(0);
    expect(screen.queryByRole("combobox", { name: "Current authorized folder" })).toBeNull();
  });

  it("connects and scans a desktop folder in one action while keeping manual settings advanced", async () => {
    const pickWorkflowSourceFolder = vi.fn().mockResolvedValue({
      absolutePath: "D:\\work\\customer-history",
      name: "Customer history",
    });
    window.myagenttoolDesktop = { pickWorkflowSourceFolder };
    mocks.api.listWorkflowSources.mockResolvedValue({ sources: [] });
    mocks.api.bindProject.mockResolvedValue({ project: { id: "project-picked" } });
    mocks.api.createWorkflowSource.mockResolvedValue({
      source: { ...source, id: "source-picked", projectId: "project-picked", name: "Customer history" },
    });
    mocks.api.scanWorkflowSource.mockResolvedValue({ source: { ...source, id: "source-picked" } });

    renderView();

    const advanced = screen.getByText("Advanced folder settings").closest("details");
    expect(advanced?.hasAttribute("open")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Choose folder" }));

    await waitFor(() => expect(mocks.api.bindProject).toHaveBeenCalledWith({
      repoPath: "D:\\work\\customer-history",
      name: "Customer history",
    }));
    expect(mocks.api.createWorkflowSource).toHaveBeenCalledWith({
      projectId: "project-picked",
      relativePath: "",
      readMode: "supported_text",
      name: "Customer history",
    });
    expect(mocks.api.scanWorkflowSource).toHaveBeenCalledWith("source-picked");
  });

  it("does not change anything when desktop folder selection is cancelled", async () => {
    window.myagenttoolDesktop = { pickWorkflowSourceFolder: vi.fn().mockResolvedValue(null) };
    mocks.api.listWorkflowSources.mockResolvedValue({ sources: [] });
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "Choose folder" }));

    await waitFor(() => expect(window.myagenttoolDesktop?.pickWorkflowSourceFolder).toHaveBeenCalled());
    expect(mocks.api.bindProject).not.toHaveBeenCalled();
    expect(mocks.api.createWorkflowSource).not.toHaveBeenCalled();
    expect(mocks.api.scanWorkflowSource).not.toHaveBeenCalled();
  });

  it("reuses and rescans an already authorized desktop folder without creating a duplicate", async () => {
    window.myagenttoolDesktop = {
      pickWorkflowSourceFolder: vi.fn().mockResolvedValue({
        absolutePath: "/work/client/history",
        name: "Historical delivery",
      }),
    };
    mocks.api.scanWorkflowSource.mockResolvedValue({ source });
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "Choose folder" }));

    await waitFor(() => expect(mocks.api.scanWorkflowSource).toHaveBeenCalledWith("source-1"));
    expect(mocks.api.bindProject).not.toHaveBeenCalled();
    expect(mocks.api.createWorkflowSource).not.toHaveBeenCalled();
  });

  it("opens an existing manual folder instead of exposing a duplicate-source error", async () => {
    renderView();
    await screen.findByText("Authorized folder");

    fireEvent.change(screen.getByLabelText(/Folder inside project/), {
      target: { value: "history" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Authorize source" }));

    expect(mocks.api.createWorkflowSource).not.toHaveBeenCalled();
    expect(screen.queryByText("workflow_source_exists")).toBeNull();
  });

  it("explains how to reauthorize a folder whose earlier access was revoked", async () => {
    window.myagenttoolDesktop = {
      pickWorkflowSourceFolder: vi.fn().mockResolvedValue({
        absolutePath: "/work/client/history",
        name: "Historical delivery",
      }),
    };
    mocks.api.listWorkflowSources.mockResolvedValue({ sources: [{ ...source, state: "revoked" }] });
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "Choose folder" }));

    expect(await screen.findByText(/Access to this folder was removed earlier/)).toBeTruthy();
    expect(mocks.api.createWorkflowSource).not.toHaveBeenCalled();
    expect(mocks.api.scanWorkflowSource).not.toHaveBeenCalled();
    const management = screen.getByText("Folder management").closest("details");
    expect(management?.hasAttribute("open")).toBe(true);
  });

  it("switches between learned work types and summarizes their user-facing states", async () => {
    const routine = (id: string, name: string, state: "published" | "disabled", version: number) => ({
      id,
      familyId: id,
      projectId: "project-1",
      sourceId: source.id,
      name,
      description: `${name} description`,
      version,
      state,
      discoveryCandidateId: null,
      historicalCaseIds: ["case-1", "case-2", "case-3"],
      triggerDocumentTypes: ["inquiry"],
      steps: [],
      confidence: 0.9,
      supersedesId: null,
      supersededById: null,
      evidenceHealth: { state: "valid", issues: [], recovery: null },
      revision: 1,
    });
    mocks.api.listBusinessRoutineDefinitions.mockResolvedValue({
      routineDefinitions: [
        routine("routine-quotes", "Prepare quotations", "published", 2),
        routine("routine-orders", "Register orders", "published", 1),
        routine("routine-archive", "Archive reports", "disabled", 1),
      ],
      count: 3,
    });

    renderView();

    const select = await screen.findByRole("combobox", { name: "Work type to view" }) as HTMLSelectElement;
    expect(screen.getByText("2 in use")).toBeTruthy();
    expect(screen.getByText("1 paused")).toBeTruthy();
    expect(within(select).getByRole("option", { name: "Prepare quotations · Enabled" })).toBeTruthy();
    expect(within(select).getByRole("option", { name: "Register orders · Enabled" })).toBeTruthy();
    fireEvent.change(select, { target: { value: "routine-orders" } });
    expect(select.value).toBe("routine-orders");
    expect(screen.getAllByText("Register orders").length).toBeGreaterThan(0);
  });

  it("keeps engineering review and history tools in one collapsed advanced area", async () => {
    renderView();

    const advanced = (await screen.findByText("Advanced learning and pilot tools")).closest("details");
    expect(advanced).toBeTruthy();
    expect(advanced?.hasAttribute("open")).toBe(false);
    const tools = within(advanced!);
    expect(tools.getByText("New requirements")).toBeTruthy();
    expect(tools.getByText("Review file roles")).toBeTruthy();
    expect(tools.getByText("Requirement → delivery cases")).toBeTruthy();
    expect(tools.getByText("Daily work types")).toBeTruthy();
    expect(tools.getByText("Workflow profiles")).toBeTruthy();
  });

  it("opens advanced tools when a task links directly to a review section", async () => {
    window.location.hash = "#workflow-file-review";
    renderView();

    const advanced = (await screen.findByText("Advanced learning and pilot tools")).closest("details");
    await waitFor(() => expect(advanced?.hasAttribute("open")).toBe(true));
    expect(document.getElementById("workflow-file-review")).toBeTruthy();
  });

  it("returns to the requesting task and clears its temporary deep link", async () => {
    window.history.replaceState({}, "", "?returnWorkItemId=work-42#workflow-routine-library");
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Back to task" }));

    expect(mocks.setSelectedWorkItemId).toHaveBeenCalledWith("work-42");
    expect(mocks.setSection).toHaveBeenCalledWith("task");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
  });

  it("reviews a discovered work type and requires explicit confirmation before enabling it", async () => {
    const discoveryCandidate = {
      id: "rdc-1",
      sourceId: source.id,
      name: "Commercial inquiry and quotation",
      state: "candidate",
      confidence: 0.92,
      triggerDocumentTypes: ["inquiry"],
      confirmedCaseIds: ["case-1", "case-2", "case-3"],
      steps: [{
        key: "quote",
        kind: "generate",
        label: "Prepare the quotation",
        required: true,
        requirement: "mandatory",
        coverage: 1,
        supportCaseIds: ["case-1", "case-2", "case-3"],
        exceptionCaseIds: [],
        explanation: "3 of 3 confirmed cases include this step.",
        evidenceRefs: [{ artifactId: requirement.id, kind: "artifact", field: null, location: null }],
        configuration: { output: "Reviewed quotation" },
      }],
      evidenceHealth: { state: "valid", issues: [], healthyCaseCount: 3 },
    };
    const draft = {
      id: "routine-1",
      familyId: "routine-1",
      sourceId: source.id,
      name: "Commercial inquiry and quotation",
      description: "Prepare a reviewed quotation.",
      version: 1,
      state: "draft",
      discoveryCandidateId: discoveryCandidate.id,
      historicalCaseIds: ["case-1", "case-2", "case-3"],
      triggerDocumentTypes: ["inquiry"],
      steps: [{
        key: "quote",
        kind: "generate",
        label: "Prepare the quotation",
        required: true,
        dependsOn: [],
        evidenceRefs: [],
        configuration: {},
      }],
      confidence: 0.92,
      supersedesId: null,
      supersededById: null,
      evidenceHealth: { state: "valid", issues: [], recovery: null },
      revision: 2,
    };
    mocks.api.listBusinessRoutineCandidates.mockResolvedValue({
      candidates: [discoveryCandidate],
      count: 1,
    });
    mocks.api.createBusinessRoutineDraft.mockResolvedValue({ routineDefinition: draft, replayed: false });

    const first = renderView();
    expect(await screen.findByRole("heading", { name: "Set up your daily work" })).toBeTruthy();
    expect(await screen.findByText("an inquiry arrives")).toBeTruthy();
    fireEvent.click(screen.getByText("Why did we identify this?"));
    expect(screen.getByText("3 of 3 confirmed cases include this step.")).toBeTruthy();
    expect(screen.getAllByText("new-requirement.md").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Review this task type" }));
    await waitFor(() => expect(mocks.api.createBusinessRoutineDraft).toHaveBeenCalledWith("rdc-1"));
    first.unmount();

    mocks.api.listBusinessRoutineCandidates.mockResolvedValue({ candidates: [], count: 0 });
    mocks.api.listBusinessRoutineDefinitions.mockResolvedValue({ routineDefinitions: [draft], count: 1 });
    mocks.api.updateBusinessRoutineDefinition.mockResolvedValue({
      routineDefinition: {
        ...draft,
        steps: [{
          ...draft.steps[0],
          configuration: { output: "Reviewed quotation document" },
        }],
        revision: 3,
      },
    });
    mocks.api.publishBusinessRoutineDefinition.mockResolvedValue({
      routineDefinition: { ...draft, state: "published", revision: 3 },
    });
    const draftView = renderView();
    const publish = await screen.findByRole("button", { name: "Enable this work type" });
    expect(document.getElementById("advanced-workflow-tools")?.contains(publish)).toBe(false);
    expect((publish as HTMLButtonElement).disabled).toBe(true);
    const output = screen.getByLabelText("Prepare the quotation Output to prepare");
    fireEvent.change(output, { target: { value: "Reviewed quotation document" } });
    const confirmation = screen.getByLabelText(
      "I reviewed the trigger, steps, outputs, ledgers, and approval points.",
    );
    expect((confirmation as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("Save the latest changes before enabling this work type.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save review" }));
    await waitFor(() => expect(mocks.api.updateBusinessRoutineDefinition).toHaveBeenCalledWith(
      "routine-1",
      expect.objectContaining({
        expectedRevision: 2,
        steps: [expect.objectContaining({
          configuration: { output: "Reviewed quotation document" },
        })],
      }),
    ));
    draftView.unmount();

    const savedDraft = {
      ...draft,
      steps: [{
        ...draft.steps[0],
        configuration: { output: "Reviewed quotation document" },
      }],
      revision: 3,
    };
    mocks.api.listBusinessRoutineDefinitions.mockResolvedValue({
      routineDefinitions: [savedDraft],
      count: 1,
    });
    renderView();
    const savedPublish = await screen.findByRole("button", { name: "Enable this work type" });
    fireEvent.click(screen.getByLabelText(
      "I reviewed the trigger, steps, outputs, ledgers, and approval points.",
    ));
    expect((savedPublish as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(savedPublish);
    await waitFor(() => expect(mocks.api.publishBusinessRoutineDefinition)
      .toHaveBeenCalledWith("routine-1", 3, true));
  });

  it("keeps execution blocked until a missing requirement is supplied, then creates a pinned task", async () => {
    renderView();

    expect((await screen.findAllByText("new-requirement.md")).length).toBeGreaterThan(0);
    expect(await screen.findByText("Baseline protected")).toBeTruthy();
    expect(screen.getByText("Top-5: 100%")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review delivery plan" }));

    const createButton = await screen.findByRole("button", { name: "Create delivery task" });
    expect((createButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Acceptance criteria"), {
      target: { value: "Includes reviewed Markdown and source links" },
    });
    expect((createButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(createButton);

    await waitFor(() => expect(mocks.api.createWorkflowRun).toHaveBeenCalledWith({
      artifactId: "req-new",
      profileId: "profile-1",
      answers: { acceptance_criteria: "Includes reviewed Markdown and source links" },
    }));
  });

  it("lets an ordinary user authorize a project-contained folder without schema input", async () => {
    mocks.api.listWorkflowSources.mockResolvedValue({ sources: [] });
    mocks.api.createWorkflowSource.mockResolvedValue({ source: { ...source, name: "My examples" } });
    renderView();

    fireEvent.change(screen.getByLabelText("Source name"), { target: { value: "My examples" } });
    fireEvent.change(screen.getByLabelText(/Folder inside project/), { target: { value: "customer/history" } });
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "supported_text" } });
    fireEvent.click(screen.getByRole("button", { name: "Authorize source" }));

    await waitFor(() => expect(mocks.api.createWorkflowSource).toHaveBeenCalledWith({
      projectId: "project-1",
      relativePath: "customer/history",
      readMode: "supported_text",
      name: "My examples",
    }));
  });

  it("keeps role corrections and profile edits explicit and revision-aware", async () => {
    mocks.api.listDeliveryCases.mockResolvedValue({
      cases: [{
        id: "case-1",
        sourceId: "source-1",
        requirementArtifactIds: ["req-old"],
        deliveryArtifactIds: ["delivery-old"],
      }],
    });
    mocks.api.confirmWorkflowArtifact.mockResolvedValue({ artifact: requirement });
    mocks.api.reviseWorkflowProfile.mockResolvedValue({
      profile: { ...profile, id: "profile-2", profileVersion: 3 },
      previousProfile: profile,
    });
    renderView();

    const role = await screen.findByLabelText("new-requirement.md role");
    fireEvent.change(role, { target: { value: "delivery" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(mocks.api.confirmWorkflowArtifact).toHaveBeenCalledWith(
      "req-new",
      { role: "delivery", expectedRevision: 1 },
    ));

    const outputPath = screen.getByLabelText("Planned output path");
    fireEvent.change(outputPath, { target: { value: "deliveries/v2/{requirement-stem}" } });
    fireEvent.click(screen.getByRole("button", { name: "Save new version" }));
    await waitFor(() => expect(mocks.api.reviseWorkflowProfile).toHaveBeenCalledWith(
      "profile-1",
      {
        expectedRevision: 1,
        outcomeSpec: {
          ...profile.outcomeSpec,
          pathTemplate: "deliveries/v2/{requirement-stem}",
        },
      },
    ));
  });

  it("collects a reason before excluding a file from learning", async () => {
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("Not a successful example");
    mocks.api.setWorkflowArtifactExclusion.mockResolvedValue({
      artifact: { ...requirement, exclusion: { reason: "Not a successful example" } },
    });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Exclude" }));
    await waitFor(() => expect(mocks.api.setWorkflowArtifactExclusion).toHaveBeenCalledWith(
      "req-new",
      {
        expectedRevision: 1,
        excluded: true,
        reason: "Not a successful example",
      },
    ));
    prompt.mockRestore();
  });

  it("updates a configured local semantic index from the retrieval gate", async () => {
    mocks.api.evaluateWorkflowRetrieval.mockResolvedValue({
      sourceId: source.id,
      retrieval: {
        version: 2,
        mode: "structured_lexical",
        vector: {
          state: "index_required",
          used: false,
          providerId: "local_http",
          model: "fixture",
          modelVersion: "v1",
          rolloutPercent: 10,
          coverage: 0,
        },
        deterministicFallback: true,
      },
      current: { sampleCount: 3, top1: 0.6, top5: 1, mrr: 0.7, noResultRate: 0 },
      baseline: { sampleCount: 3, top1: 0.6, top5: 1, mrr: 0.7, noResultRate: 0 },
      gate: { status: "passed", minimumSamples: 3, embeddingEligible: false },
      samples: [],
    });
    mocks.api.indexWorkflowSourceEmbeddings.mockResolvedValue({
      index: { eligible: 3, indexed: 3, reused: 0, truncated: false },
    });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Update local semantic index" }));
    await waitFor(() =>
      expect(mocks.api.indexWorkflowSourceEmbeddings).toHaveBeenCalledWith(source.id));
  });

  it("lets users correct learning evidence and publish only a reviewed profile draft", async () => {
    const delivery = {
      ...requirement,
      id: "delivery-1",
      name: "delivery.md",
      role: "delivery",
      relativePath: "history/delivery.md",
    };
    const deliveryCase = {
      id: "case-1",
      sourceId: source.id,
      projectId: "project-1",
      requirementArtifactIds: [requirement.id],
      deliveryArtifactIds: [delivery.id],
      referenceArtifactIds: [],
      draftArtifactIds: [],
      state: "confirmed",
      qualityAssessment: {
        version: 1,
        score: 0.61,
        status: "review",
        metrics: {
          evidenceIntegrity: 1,
          pairingConfidence: 0.2,
          parsingCoverage: 0.5,
          roleConfidence: 1,
        },
        blockers: [],
        warnings: ["low_pairing_confidence"],
      },
      revision: 1,
    };
    const draft = {
      id: "draft-1",
      sourceId: source.id,
      projectId: "project-1",
      familyId: profile.familyId,
      baseProfileId: profile.id,
      baseProfileVersion: profile.profileVersion,
      baseProfileRevision: profile.revision,
      state: "draft",
      proposedProfile: {
        ...profile,
        name: "Article delivery reviewed",
        evidenceCaseIds: ["case-1"],
      },
      changes: {
        requirementFields: { added: ["audience"], removed: [] },
        requiredSections: { added: [], removed: [] },
        outputs: { added: [], removed: [] },
        pathTemplate: {
          before: profile.outcomeSpec.pathTemplate,
          after: profile.outcomeSpec.pathTemplate,
          changed: false,
        },
        evidenceCases: { added: [], removed: ["case-2", "case-3"] },
      },
      impact: { activeCaseCount: 1, archivedCaseCount: 2, pendingRequirementCount: 1 },
      revision: 1,
    };
    mocks.api.listWorkflowArtifacts.mockResolvedValue({ artifacts: [requirement, delivery] });
    mocks.api.listDeliveryCases.mockResolvedValue({ cases: [deliveryCase] });
    mocks.api.listWorkflowProfileDrafts.mockResolvedValue({ drafts: [draft] });
    mocks.api.changeDeliveryCaseState.mockResolvedValue({ deliveryCase: { ...deliveryCase, state: "archived" } });
    mocks.api.createWorkflowProfileDraft.mockResolvedValue({ draft });
    mocks.api.publishWorkflowProfileDraft.mockResolvedValue({ draft: { ...draft, state: "published" } });
    vi.spyOn(window, "prompt").mockReturnValue("Wrong requirement-delivery pairing");

    renderView();

    expect((await screen.findAllByText(/Learning quality/)).length).toBeGreaterThan(0);
    expect(await screen.findByText("Requirement and delivery may not belong together")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Archive case" }));
    await waitFor(() => expect(mocks.api.changeDeliveryCaseState).toHaveBeenCalledWith(
      "case-1",
      "archive",
      { expectedRevision: 1, reason: "Wrong requirement-delivery pairing" },
    ));

    fireEvent.click(screen.getByRole("button", { name: "Rebuild draft" }));
    await waitFor(() => expect(mocks.api.createWorkflowProfileDraft).toHaveBeenCalledWith(
      profile.id,
      { expectedRevision: profile.revision },
    ));

    expect(screen.getByText("Article delivery reviewed")).toBeTruthy();
    expect(screen.getByText("+ field: audience")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Publish draft" }));
    await waitFor(() => expect(mocks.api.publishWorkflowProfileDraft).toHaveBeenCalledWith("draft-1", 1));
  });

  it("starts a planned delivery with the selected agent", async () => {
    const run = {
      id: "run-1",
      projectId: "project-1",
      sourceId: "source-1",
      workItemId: "work-item-1",
      profileVersion: 2,
      status: "planned",
      revision: 3,
      createdAt: "2026-07-28T12:00:00.000Z",
      plannedOutputs: [{ relativePath: "deliveries/result.md" }],
      validationResults: [],
      execution: null,
    };
    mocks.api.listWorkflowRuns.mockResolvedValue({ runs: [run] });
    mocks.api.executeWorkflowRun.mockResolvedValue({
      run: { ...run, status: "executing", revision: 4 },
      replayed: false,
    });
    renderView();

    expect((await screen.findByRole(
      "combobox",
      { name: "Execution agent: run-1" },
    ) as HTMLSelectElement).value).toBe("agent-1");
    fireEvent.click(screen.getByRole("button", { name: "Start delivery" }));

    await waitFor(() => expect(mocks.api.executeWorkflowRun).toHaveBeenCalledWith(
      "run-1",
      { expectedRevision: 3, agentId: "agent-1" },
    ));
  });

  it("shows versioned validation blockers and warnings with file evidence", async () => {
    mocks.api.listWorkflowRuns.mockResolvedValue({
      runs: [{
        id: "run-validation",
        projectId: "project-1",
        sourceId: "source-1",
        workItemId: "work-item-1",
        profileVersion: 2,
        status: "validation_failed",
        revision: 4,
        createdAt: "2026-07-28T12:00:00.000Z",
        plannedOutputs: [{ relativePath: "deliveries/result.md" }],
        validationSummary: {
          validatorVersion: 2,
          passed: false,
          blockerCount: 1,
          warningCount: 1,
          checkedAt: "2026-07-28T12:05:00.000Z",
        },
        validationResults: [{
          id: "local_attachment:deliveries/result.md",
          criterion: "Local attachment exists",
          severity: "blocker",
          status: "failed",
          file: "deliveries/result.md",
          note: "Local attachment is missing: assets/chart.png",
        }, {
          id: "historical_size:deliveries/result.md",
          criterion: "Output size resembles trusted deliveries",
          severity: "warning",
          status: "warning",
          file: "deliveries/result.md",
          note: "There are not enough trusted historical deliveries for a size comparison.",
        }],
        execution: null,
      }],
    });
    renderView();

    expect(await screen.findByText("v2 · 1 blocking issues · 1 warnings")).toBeTruthy();
    expect(screen.getByText(/Local attachment is missing: assets\/chart.png/)).toBeTruthy();
    expect(screen.getByText(/not enough trusted historical deliveries/)).toBeTruthy();
  });

  it("collects a categorized explanation before accepting edited output", async () => {
    const run = {
      id: "run-feedback",
      projectId: "project-1",
      sourceId: "source-1",
      workItemId: "work-item-1",
      profileVersion: 2,
      status: "awaiting_acceptance",
      revision: 6,
      createdAt: "2026-07-28T12:00:00.000Z",
      plannedOutputs: [{ relativePath: "deliveries/result.md" }],
      validationResults: [],
      execution: null,
      feedback: null,
    };
    mocks.api.listWorkflowRuns.mockResolvedValue({ runs: [run] });
    mocks.api.recordWorkflowRunFeedback.mockResolvedValue({
      run: { ...run, status: "accepted", revision: 7 },
      deliveryCase: null,
      profileDraft: null,
      learning: {
        status: "pending_publication",
        deliveryCaseId: null,
        profileDraftId: null,
        reason: "outputs_not_published",
      },
    });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Accept with edits" }));
    fireEvent.change(screen.getByLabelText("Reason: run-feedback"), {
      target: { value: "structure_adjusted" },
    });
    const submit = screen.getByRole("button", { name: "Save feedback" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("What changed or went wrong?: run-feedback"), {
      target: { value: "Added a reviewed risk section." },
    });
    fireEvent.click(submit);

    await waitFor(() => expect(mocks.api.recordWorkflowRunFeedback).toHaveBeenCalledWith(
      "run-feedback",
      {
        expectedRevision: 6,
        feedback: "accepted_with_edits",
        reasonCode: "structure_adjusted",
        note: "Added a reviewed risk section.",
      },
    ));
  });

  it("requires an explicit checked publication preview before writing accepted outputs", async () => {
    const run = {
      id: "run-publish",
      projectId: "project-1",
      sourceId: "source-1",
      workItemId: "work-item-1",
      profileVersion: 2,
      status: "accepted",
      revision: 8,
      createdAt: "2026-07-28T12:00:00.000Z",
      plannedOutputs: [{ relativePath: "deliveries/result.md" }],
      validationResults: [],
      feedback: {
        state: "accepted",
        note: "",
        deliveryCaseId: null,
        profileRevisionRecommended: false,
      },
      publication: {
        version: 1,
        id: "publication-1",
        state: "previewed",
        previewDigest: "a".repeat(64),
        attemptNumber: 1,
        worktreeId: "worktree-1",
        targetProjectId: "project-1",
        files: [{
          relativePath: "deliveries/result.md",
          extension: "md",
          bytes: 120,
          sha256: "b".repeat(64),
          sourceModifiedAt: "2026-07-28T12:05:00.000Z",
          targetState: "available",
          conflictType: null,
        }],
        conflictCount: 0,
        previewedAt: "2026-07-28T12:06:00.000Z",
        previewedBy: "user-1",
      },
      execution: null,
    };
    mocks.api.listWorkflowRuns.mockResolvedValue({ runs: [run] });
    mocks.api.publishWorkflowRunOutputs.mockResolvedValue({
      run: { ...run, revision: 9, publication: { ...run.publication, state: "published" } },
      publication: { ...run.publication, state: "published" },
      deliveryCase: null,
      profileDraft: null,
      replayed: false,
    });
    renderView();

    expect((await screen.findAllByText("deliveries/result.md")).length).toBeGreaterThan(0);
    const publish = screen.getByRole("button", { name: "Publish outputs" });
    expect((publish as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(
      "I reviewed the target paths and want to publish these files.: run-publish",
    ));
    expect((publish as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(publish);

    await waitFor(() => expect(mocks.api.publishWorkflowRunOutputs).toHaveBeenCalledWith(
      "run-publish",
      {
        expectedRevision: 8,
        publicationId: "publication-1",
        confirmed: true,
      },
    ));
  });

  it("restarts a cancelled delivery while keeping its earlier attempt visible", async () => {
    const run = {
      id: "run-cancelled",
      projectId: "project-1",
      sourceId: "source-1",
      workItemId: "work-item-1",
      profileVersion: 2,
      status: "execution_cancelled",
      revision: 5,
      createdAt: "2026-07-28T12:00:00.000Z",
      plannedOutputs: [{ relativePath: "deliveries/result.md" }],
      validationResults: [],
      execution: {
        autoRunId: "auto-old",
        status: "cancelled",
        agentId: "agent-1",
      },
      executionAttempts: [{
        number: 1,
        autoRunId: "auto-old",
        status: "cancelled",
        agentId: "agent-1",
        worktreeId: "worktree-old",
        invocationId: "inv-old",
        invocationIds: ["inv-old"],
        trigger: "initial",
        retryCount: 0,
        startedAt: "2026-07-28T12:01:00.000Z",
        completedAt: "2026-07-28T12:02:00.000Z",
        error: null,
        errorCode: null,
      }],
    };
    mocks.api.listWorkflowRuns.mockResolvedValue({ runs: [run] });
    mocks.api.executeWorkflowRun.mockResolvedValue({
      run: { ...run, status: "executing", revision: 6 },
      replayed: false,
    });
    renderView();

    expect(await screen.findByText("Execution attempts · 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start again" }));

    await waitFor(() => expect(mocks.api.executeWorkflowRun).toHaveBeenCalledWith(
      "run-cancelled",
      { expectedRevision: 5, agentId: "agent-1" },
    ));
  });

  it("compares two attempts and safely cleans only the older worktree", async () => {
    const attempts = [
      {
        number: 1,
        autoRunId: "auto-1",
        status: "cancelled",
        agentId: "agent-1",
        worktreeId: "worktree-1",
        invocationId: "inv-1",
        invocationIds: ["inv-1"],
        trigger: "initial",
        retryCount: 0,
        startedAt: "2026-07-28T12:01:00.000Z",
        completedAt: "2026-07-28T12:02:00.000Z",
        error: null,
        errorCode: null,
        cleanup: null,
      },
      {
        number: 2,
        autoRunId: "auto-2",
        status: "running",
        agentId: "agent-1",
        worktreeId: "worktree-2",
        invocationId: "inv-2",
        invocationIds: ["inv-2"],
        trigger: "restart_after_cancel",
        retryCount: 0,
        startedAt: "2026-07-28T12:03:00.000Z",
        completedAt: null,
        error: null,
        errorCode: null,
        cleanup: null,
      },
    ];
    const run = {
      id: "run-compare",
      projectId: "project-1",
      sourceId: "source-1",
      workItemId: "work-item-1",
      profileVersion: 2,
      status: "executing",
      revision: 7,
      createdAt: "2026-07-28T12:00:00.000Z",
      plannedOutputs: [{ relativePath: "deliveries/result.md" }],
      validationResults: [],
      execution: { autoRunId: "auto-2", status: "running", agentId: "agent-1" },
      executionAttempts: attempts,
    };
    mocks.api.listWorkflowRuns.mockResolvedValue({ runs: [run] });
    mocks.api.worktreeDiff.mockImplementation(async (id: string) => ({
      files: id === "worktree-1"
        ? [{ path: "old.md", index: " ", work: "?", untracked: true }]
        : [{ path: "new.md", index: " ", work: "?", untracked: true }],
      base: "HEAD",
      diff: "",
      truncated: false,
    }));
    mocks.api.cleanupWorkflowRunAttemptWorktree.mockResolvedValue({
      run: { ...run, revision: 8 },
      attempt: { ...attempts[0], cleanup: { state: "cleaned" } },
      replayed: false,
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderView();

    fireEvent.click(await screen.findByText("Execution attempts · 2"));
    fireEvent.click(screen.getByRole("button", { name: "Compare latest two" }));
    await screen.findByText("Attempt comparison");
    expect(screen.getByText("old.md")).toBeTruthy();
    expect(screen.getByText("new.md")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clean old worktree" }));
    await waitFor(() => expect(mocks.api.cleanupWorkflowRunAttemptWorktree).toHaveBeenCalledWith(
      "run-compare",
      1,
      7,
    ));
    expect(screen.getAllByRole("button", { name: "Clean old worktree" })).toHaveLength(1);
  });
});
