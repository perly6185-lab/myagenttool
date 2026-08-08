import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveWorkItemUserStatus, WorkItemSummaryView } from "./work-item-summary-view";
import type { LocalWorkItem } from "./task-view-types";
import { i18n } from "@/lib/i18n";

const mocks = vi.hoisted(() => ({
  getWorkItem: vi.fn(),
  updateWorkItem: vi.fn(),
  suggestWorkItemDraft: vi.fn(),
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
  taskMaterialContentUrl: vi.fn((workItemId, assetId, download = false) => `/materials/${workItemId}/${assetId}${download ? "?download=1" : ""}`),
}));

vi.mock("@/data/use-console-state", () => ({
  useConsoleState: () => ({ data: { users: [{ id: "usr_1", name: "Morgan" }] } }),
}));

vi.mock("@/data/use-console-actions", () => ({
  api: {
    getWorkItem: mocks.getWorkItem,
    updateWorkItem: mocks.updateWorkItem,
    suggestWorkItemDraft: mocks.suggestWorkItemDraft,
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
    taskMaterialContentUrl: mocks.taskMaterialContentUrl,
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
  mocks.listWorkItemComments.mockResolvedValue({ comments: [] });
  mocks.autoRunReadiness.mockResolvedValue({ readiness: { ready: true, checks: [] } });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("work item summary presentation", () => {
  it("derives one user-facing status from business, planning, and execution state", () => {
    expect(deriveWorkItemUserStatus(item({ state: "closed" }))).toBe("completed");
    expect(deriveWorkItemUserStatus(item({ executionState: "failed" }))).toBe("needs_action");
    expect(deriveWorkItemUserStatus(item({ executionState: "completed" }))).toBe("ready_for_review");
    expect(deriveWorkItemUserStatus(item({ executionState: "completed", waitingOn: "me" }))).toBe("ready_for_review");
    expect(deriveWorkItemUserStatus(item({ executionState: "awaiting_approval", waitingOn: "me" }))).toBe("needs_action");
    expect(deriveWorkItemUserStatus(item({ status: "blocked", executionState: "unclaimed" }))).toBe("blocked");
    expect(deriveWorkItemUserStatus(item({ executionState: "running" }))).toBe("ai_working");
    expect(deriveWorkItemUserStatus(item({ executionState: "unclaimed", plannedDate: null, waitingOn: "requester" }))).toBe("waiting");
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

    expect((await screen.findByRole("alert", { name: "Preflight" })).textContent).toContain("No default agent is configured");
    expect((screen.getByRole("button", { name: "Let AI start" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Open setup and fix" }));
    expect(onOpenSetup).toHaveBeenCalledWith("agents");
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

    expect((await screen.findByRole("alert", { name: "Preflight" })).textContent).toContain("could not be completed");
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

  it("hands the task to AI with one click and lets the run establish its execution contract", async () => {
    const unplanned = item({
      status: "backlog",
      executionState: "unclaimed",
      plannedDate: null,
      acceptanceCriteria: [],
      verificationSop: [],
      executionContractGate: { ready: false, missing: ["acceptance_criteria", "verification_sop", "confirmation"], source: null, confirmedAt: null },
    });
    mocks.getWorkItem.mockResolvedValue({ workItem: unplanned });
    mocks.updateWorkItem.mockResolvedValue({ workItem: item({ status: "ready", executionPolicy: "auto", waitingOn: "ai" }) });
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "Let AI start" }));
    await waitFor(() => expect(mocks.updateWorkItem).toHaveBeenCalledWith("lwi_1", expect.objectContaining({
      expectedRevision: unplanned.revision,
      executionPolicy: "auto",
      waitingOn: "ai",
      status: "ready",
    })));
    expect(mocks.suggestWorkItemDraft).not.toHaveBeenCalled();
    expect(mocks.startWorkItemAutoRun).not.toHaveBeenCalled();
    expect(await screen.findByText(/set to automatic/i)).toBeTruthy();
  });

  it("answers AI clarification from the task and resumes the same run", async () => {
    mocks.getWorkItem.mockResolvedValue({
      workItem: item({ executionState: "awaiting_approval", waitingOn: "me" }),
      observability: {
        latestRun: {
          id: "aur_clarify",
          status: "needs_input",
          phase: "waiting_for_input",
          updatedAt: "2026-08-07T01:00:00.000Z",
          decision: {
            path: "clarify",
            decidedBy: "agent",
            confidence: 0.8,
            clarifyingQuestions: ["Should an invalid timezone fall back to UTC or stop scheduling?"],
          },
        },
      },
    });
    mocks.answerClarify.mockResolvedValue({ ok: true, resumed: true });
    render(<WorkItemSummaryView workItemId="lwi_1" onOpenExpert={() => {}} />);

    expect(await screen.findByText("AI needs your decision before continuing")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/Answer the questions above/), { target: { value: "Fall back to UTC and record a warning." } });
    fireEvent.click(screen.getByRole("button", { name: "Submit and continue" }));

    await waitFor(() => expect(mocks.answerClarify).toHaveBeenCalledWith("aur_clarify", "Fall back to UTC and record a warning."));
    expect(await screen.findByText(/continue in the same task run/i)).toBeTruthy();
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

    expect(await screen.findByText(/no pre-execution acceptance basis/i)).toBeTruthy();
    expect(screen.queryByText(/AI-suggested completion criteria/i)).toBeNull();
    expect(screen.getByText("Not established")).toBeTruthy();
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
    expect(screen.getByText("Propagated the terminal timezone through local scheduling.")).toBeTruthy();
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

    expect(await screen.findByText("Result passed Codex review and automated verification")).toBeTruthy();
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
