import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ccusageSourcesFor, codexCapabilityTools, isCodexCliAgent, ToolsView } from "@/features/tools/tools-view";
import { useUiStore } from "@/store/ui-store";
import type { ConsoleSnapshot, ToolDescriptor } from "@/lib/console-state";

const apiMock = vi.hoisted(() => ({
  fetchState: vi.fn(),
  listTools: vi.fn(),
  createToolInvocation: vi.fn(),
  reviewCodexPatchProposal: vi.fn(),
  approveApproval: vi.fn(),
}));

vi.mock("@/lib/api-client", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client")),
  fetchState: apiMock.fetchState,
  api: {
    listTools: apiMock.listTools,
    createToolInvocation: apiMock.createToolInvocation,
    reviewCodexPatchProposal: apiMock.reviewCodexPatchProposal,
    approveApproval: apiMock.approveApproval,
  },
}));

beforeEach(() => {
  apiMock.fetchState.mockResolvedValue(consoleState());
  apiMock.listTools.mockResolvedValue({ tools: codexTools() });
  apiMock.createToolInvocation.mockImplementation((name: string, input: Record<string, unknown> = {}) => {
    if (name === "codex.plan.change") {
      return Promise.resolve({
        tool: name,
        invocationId: "inv_codex_plan",
        agentId: "agt_codex_plan_change",
        status: "queued",
        outputCollection: "codexChangePlans",
      });
    }
    if (name === "codex.propose.patch") {
      return Promise.resolve({
        tool: name,
        invocationId: "inv_codex_proposal",
        agentId: "agt_codex_propose_patch",
        status: "queued",
        outputCollection: "codexPatchProposals",
      });
    }
    if (name === "codex.apply.patch") {
      return Promise.resolve({
        tool: name,
        invocationId: input.approvalRequestId ? "inv_codex_apply" : "inv_codex_apply_approval",
        agentId: input.approvalRequestId ? "agt_codex_apply_patch" : "agt_platform_application_control",
        status: input.approvalRequestId ? "queued" : "waiting_for_local_approval",
        approvalRequestId: input.approvalRequestId ? null : "apr_apply",
        approvalRequestRequired: !input.approvalRequestId,
        outputCollection: "codexPatchProposals",
      });
    }
    return Promise.resolve({
      tool: name,
      invocationId: "inv_codex_review",
      agentId: "agt_codex_review_diff",
      status: "queued",
      outputCollection: "codexReviewFindings",
    });
  });
  apiMock.reviewCodexPatchProposal.mockResolvedValue({
    proposal: { ...consoleState().codexPatchProposals![0], reviewState: "approved" },
  });
  apiMock.approveApproval.mockResolvedValue({ approval: { id: "apr_apply", status: "approved" } });
  useUiStore.setState({
    section: "tools",
    selectedToolName: null,
    selectedToolFocus: null,
    selectedInvocationId: null,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useUiStore.setState({
    section: "dashboard",
    selectedToolName: null,
    selectedToolFocus: null,
    selectedInvocationId: null,
  });
});

function mockClipboard() {
  const writeText = vi.fn();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

// Regression for the #240 review fix: a provider-specific source is only offered
// for a matching provider report, so the UI can't build a request the backend
// rejects with source_report_mismatch.
describe("ccusageSourcesFor", () => {
  it("offers only 'all' for a generic report", () => {
    expect(ccusageSourcesFor("daily")).toEqual(["all"]);
    expect(ccusageSourcesFor("weekly")).toEqual(["all"]);
    expect(ccusageSourcesFor("monthly")).toEqual(["all"]);
    expect(ccusageSourcesFor("session")).toEqual(["all"]);
  });

  it("adds 'codex' only for a codex_ report", () => {
    expect(ccusageSourcesFor("codex_daily")).toEqual(["all", "codex"]);
  });

  it("adds 'claude' only for a claude_ report", () => {
    expect(ccusageSourcesFor("claude_daily")).toEqual(["all", "claude"]);
  });

  it("never mixes provider sources across providers", () => {
    expect(ccusageSourcesFor("codex_daily")).not.toContain("claude");
    expect(ccusageSourcesFor("claude_daily")).not.toContain("codex");
  });
});

describe("codexCapabilityTools", () => {
  it("keeps only governed Codex tool facades", () => {
    expect(codexCapabilityTools([
      tool("codex.review.diff", "Codex Diff Review", "codexReviewFindings"),
      tool("ccusage.report", "ccusage", "importedUsageEstimates"),
      tool("codex.plan.change", "Codex Change Plan", "codexChangePlans"),
    ]).map((item) => item.name)).toEqual(["codex.review.diff", "codex.plan.change"]);
  });
});

describe("isCodexCliAgent", () => {
  it("detects ordinary Codex CLI agents separately from governed tool facades", () => {
    expect(isCodexCliAgent({
      id: "agt_codex_cli",
      name: "Codex CLI",
      status: "available",
      adapter: { type: "cli", command: "codex", args: ["exec", "--json", "{{task}}"] },
    })).toBe(true);
    expect(isCodexCliAgent({
      id: "agt_demo",
      name: "Demo Agent",
      status: "available",
      adapter: { type: "cli", command: "node", args: ["demo.mjs"] },
    })).toBe(false);
  });
});

describe("ToolsView Codex capability case", () => {
  it("surfaces the Codex capability suite and runs safe review and plan checks", async () => {
    const writeText = mockClipboard();
    renderWithClient(createElement(ToolsView));

    expect(await screen.findByText("Codex capability case")).toBeTruthy();
    expect(screen.getByText("4/4 ready")).toBeTruthy();
    expect(screen.getByText("Codex CLI available")).toBeTruthy();
    expect(screen.getByText("4/4 registered")).toBeTruthy();
    expect(screen.getByText("1 selectable")).toBeTruthy();
    expect(screen.getByText("Codex lifecycle")).toBeTruthy();
    expect(screen.getByText("Review evidence")).toBeTruthy();
    expect(screen.getByText("Change plan")).toBeTruthy();
    expect(screen.getByText("Patch apply")).toBeTruthy();
    expect(screen.getByText("Awaiting proposal review")).toBeTruthy();
    expect(screen.getByText("Operations queue")).toBeTruthy();
    expect(screen.getByText("2 pending")).toBeTruthy();
    expect(screen.getByText("Review patch proposal")).toBeTruthy();
    expect(screen.getByText("Inspect blocked Codex run")).toBeTruthy();
    expect(screen.getByText("codexReviewFindings")).toBeTruthy();
    expect(screen.getAllByText("Check regression").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Plan summary").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Patch proposal summary").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /Copy use case path/i }));
    expect(writeText).toHaveBeenCalledWith("docs/engineering/CODEX_CAPABILITY_USE_CASE.md");
    expect(screen.getByText("Copied use case path.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Run diff review/i }));
    await waitFor(() => {
      expect(apiMock.createToolInvocation).toHaveBeenCalledWith("codex.review.diff", {
        projectId: "prj_local",
        worktreeId: "wt_main",
        severityFloor: "medium",
        instruction: "Focus on correctness, regressions, and missing tests.",
      });
    });
    expect(await screen.findByText("inv_codex_review")).toBeTruthy();
    expect(screen.getByText("Diff review run")).toBeTruthy();
    expect(screen.getByText("Codex review completed with 1 high finding.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Run change plan/i }));
    await waitFor(() => {
      expect(apiMock.createToolInvocation).toHaveBeenCalledWith("codex.plan.change", {
        projectId: "prj_local",
        worktreeId: "wt_main",
        goal: "Plan the next safe productization step for this worktree.",
        constraints: "Do not write files. Return a bounded implementation plan and verification steps.",
        severityFloor: "medium",
      });
    });
    expect(await screen.findByText("inv_codex_plan")).toBeTruthy();
    expect(screen.getByText("Change plan run")).toBeTruthy();
    expect(screen.getByText("Error: codex: command not found")).toBeTruthy();
    expect(screen.getByText(/Install or re-register the governed Codex wrapper/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Generate patch proposal/i }));
    await waitFor(() => {
      expect(apiMock.createToolInvocation).toHaveBeenCalledWith("codex.propose.patch", {
        projectId: "prj_local",
        worktreeId: "wt_main",
        goal: "Plan the next safe productization step for this worktree.",
        constraints: "Do not apply the patch. Return a bounded reviewable diff artifact.",
        basePlanId: "ccp_1",
        maxFiles: 4,
      });
    });
    expect(await screen.findByText("Patch proposal run")).toBeTruthy();
    expect(screen.getByText("inv_codex_proposal")).toBeTruthy();
    expect(screen.getByText("Patch proposal review")).toBeTruthy();
    expect(screen.getByText("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBeTruthy();
    expect(screen.getByText(/Apply is enabled only after/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Approve proposal/i }));
    await waitFor(() => {
      expect(apiMock.reviewCodexPatchProposal).toHaveBeenCalledWith("cpp_1", { action: "approve" });
    });

    fireEvent.click(screen.getByRole("button", { name: /Reject proposal/i }));
    await waitFor(() => {
      expect(apiMock.reviewCodexPatchProposal).toHaveBeenCalledWith("cpp_1", { action: "reject" });
    });
  });

  it("requests approval and retries an approved Codex patch apply", async () => {
    apiMock.fetchState.mockResolvedValue({
      ...consoleState(),
      codexPatchProposals: [{
        ...consoleState().codexPatchProposals![0],
        id: "cpp_approved",
        reviewState: "approved",
        patchSha256: "b".repeat(64),
      }],
    });
    renderWithClient(createElement(ToolsView));

    expect(await screen.findByText("cpp_approved")).toBeTruthy();
    expect(screen.getByText("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Apply approved patch/i }));
    await waitFor(() => {
      expect(apiMock.createToolInvocation).toHaveBeenCalledWith("codex.apply.patch", {
        projectId: "prj_local",
        worktreeId: "wt_main",
        proposalId: "cpp_approved",
        patchSha256: "b".repeat(64),
      });
    });
    expect(await screen.findByText("apr_apply")).toBeTruthy();
    expect(screen.getByText("Local apply approval")).toBeTruthy();
    expect(screen.getByText("Waiting for local approval")).toBeTruthy();
    expect(screen.getByText("Approve and retry patch apply")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Approve and retry$/i }));
    await waitFor(() => expect(apiMock.approveApproval).toHaveBeenCalledWith("apr_apply"));
    await waitFor(() => {
      expect(apiMock.createToolInvocation).toHaveBeenCalledWith("codex.apply.patch", {
        projectId: "prj_local",
        worktreeId: "wt_main",
        proposalId: "cpp_approved",
        patchSha256: "b".repeat(64),
        approvalRequestId: "apr_apply",
      });
    });
    expect(await screen.findByText("inv_codex_apply")).toBeTruthy();
  });

  it("does not offer proposal review actions after a Codex patch is applied", async () => {
    apiMock.fetchState.mockResolvedValue({
      ...consoleState(),
      codexPatchProposals: [{
        ...consoleState().codexPatchProposals![0],
        id: "cpp_applied",
        reviewState: "applied",
        appliedInvocationId: "inv_apply_done",
      }],
    });
    renderWithClient(createElement(ToolsView));

    expect(await screen.findByText("cpp_applied")).toBeTruthy();
    expect(screen.getByText(/Applied by inv_apply_done/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Approve proposal/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Reject proposal/i })).toBeNull();
  });

  it("shows Codex setup readiness when only the ordinary CLI agent exists", async () => {
    apiMock.listTools.mockResolvedValue({ tools: [] });
    apiMock.fetchState.mockResolvedValue({
      ...consoleState(),
      worktrees: [],
      agents: [codexCliAgent()],
      reviewFindings: [],
      codexChangePlans: [],
      codexPatchProposals: [],
    });

    renderWithClient(createElement(ToolsView));

    expect(await screen.findByText("Codex capability case")).toBeTruthy();
    expect(screen.getByText("0/4 ready")).toBeTruthy();
    expect(screen.getByText("Codex CLI available")).toBeTruthy();
    expect(screen.getByText("0/4 registered")).toBeTruthy();
    expect(screen.getByText("No worktree in state")).toBeTruthy();
    expect(screen.getByText(/Create or select a project worktree/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Run diff review/i })).toBeTruthy();
  });
});

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchInterval: false },
      mutations: { retry: false },
    },
  });
  return render(createElement(QueryClientProvider, { client }, ui));
}

function tool(name: string, displayName: string, outputCollection: string): ToolDescriptor {
  return {
    name,
    version: "1",
    displayName,
    description: displayName,
    riskLevel: name === "codex.review.diff" || name === "codex.plan.change" ? "low" : "medium",
    riskTags: ["local_agent"],
    requiresLocalDevice: true,
    agents: [{ id: `agt_${name.replaceAll(".", "_")}`, name: displayName, status: "active" }],
    authoritativeBilling: false,
    outputCollection,
  };
}

function codexTools(): ToolDescriptor[] {
  return [
    tool("codex.review.diff", "Codex Diff Review", "codexReviewFindings"),
    tool("codex.plan.change", "Codex Change Plan", "codexChangePlans"),
    tool("codex.propose.patch", "Codex Patch Proposal", "codexPatchProposals"),
    tool("codex.apply.patch", "Codex Apply Patch", "codexPatchProposals"),
  ];
}

function consoleState(): ConsoleSnapshot {
  return {
    device: {
      id: "dev_local",
      name: "Local",
      status: "online",
      platform: "win32",
      architecture: "x64",
      lastSeenAt: "2026-07-07T00:00:00.000Z",
      maxConcurrency: 2,
    },
    agent: null,
    agents: [codexCliAgent()],
    projects: [{
      id: "prj_local",
      name: "Local Project",
      color: "#2563eb",
      ownerTeamId: "team_local",
      budgetPoolId: null,
      defaultAgentId: null,
      status: "active",
      isolation: "worktree",
      createdAt: "2026-07-07T00:00:00.000Z",
    }],
    worktrees: [{
      id: "wt_main",
      projectId: "prj_local",
      targetId: "target_local",
      branch: "main",
      path: "D:/repo",
      isMain: true,
      createdAt: "2026-07-07T00:00:00.000Z",
    }],
    invocations: [{
      id: "inv_codex_review",
      status: "succeeded",
      agentId: "agt_codex_review_diff",
      projectId: "prj_local",
      worktreeId: "wt_main",
      result: { summary: "Codex review completed with 1 high finding." },
      createdAt: "2026-07-07T04:00:00.000Z",
      options: { metadata: { tool: "codex.review.diff" } },
    }, {
      id: "inv_codex_plan",
      status: "failed",
      agentId: "agt_codex_plan_change",
      projectId: "prj_local",
      worktreeId: "wt_main",
      explanation: {
        state: "failed",
        reason: "Error: codex: command not found",
        reasonCode: "failed",
        summary: "Error: codex: command not found",
        waitingOn: null,
        resultLocation: null,
        nextAction: "Review local setup.",
        recovery: null,
        approval: null,
      },
      createdAt: "2026-07-07T04:01:00.000Z",
      options: { metadata: { tool: "codex.plan.change" } },
    }],
    events: [],
    auditSummaries: [],
    reviewFindings: [{
      id: "crf_1",
      source: "codex",
      reviewInvocationId: "inv_review_old",
      invocationId: "inv_review_old",
      projectId: "prj_local",
      worktreeId: "wt_main",
      tool: "codex.review.diff",
      mode: "diff-review",
      findingIndex: 0,
      severity: "high",
      file: "src/app.ts",
      message: "Check regression",
      confidence: "high",
      authoritative: false,
      createdAt: "2026-07-07T01:00:00.000Z",
    }],
    codexChangePlans: [{
      id: "ccp_1",
      source: "codex",
      planInvocationId: "inv_plan_old",
      invocationId: "inv_plan_old",
      projectId: "prj_local",
      worktreeId: "wt_main",
      tool: "codex.plan.change",
      mode: "change-plan",
      summary: "Plan summary",
      steps: [{ title: "Add case", files: ["src/app.ts"], risk: "medium" }],
      openQuestions: [],
      verification: ["pnpm test"],
      authoritative: false,
      createdAt: "2026-07-07T02:00:00.000Z",
    }],
    codexPatchProposals: [{
      id: "cpp_1",
      source: "codex",
      proposalInvocationId: "inv_proposal_old",
      invocationId: "inv_proposal_old",
      projectId: "prj_local",
      worktreeId: "wt_main",
      tool: "codex.propose.patch",
      mode: "patch-proposal",
      summary: "Patch proposal summary",
      files: [{ path: "src/app.ts", changeType: "modify", risk: "medium" }],
      diffPreview: "diff --git a/src/app.ts b/src/app.ts",
      patchSha256: "a".repeat(64),
      verification: ["pnpm test"],
      immutable: true,
      reviewState: "generated",
      authoritative: false,
      createdAt: "2026-07-07T03:00:00.000Z",
    }],
  };
}

function codexCliAgent() {
  return {
    id: "agt_codex_cli",
    name: "Codex CLI",
    status: "available",
    adapter: { type: "cli", command: "codex", args: ["exec", "--json", "{{task}}"] },
  };
}
