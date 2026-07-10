import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clipboard, FileText, GitPullRequestArrow, ListChecks, Play, ShieldAlert, ShieldCheck, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { EmptyState } from "@/components/common/empty-state";
import { SectionHeading } from "@/components/common/section-heading";
import { useConsoleState } from "@/data/use-console-state";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { useUiStore } from "@/store/ui-store";
import { cn } from "@/lib/cn";
import { readableStatus, statusTone } from "@/lib/readable-labels";
import { CODEX_TOOL_NAMES } from "@/features/tools/codex-ops";
import type {
  AgentSnapshot,
  ApprovalSnapshot,
  CodexChangePlan,
  CodexPatchProposal,
  InvocationSnapshot,
  ProjectSnapshot,
  ReviewFinding,
  ToolDescriptor,
  ToolInvocationRequest,
  WorktreeSnapshot,
} from "@/lib/console-state";

const TOOLS_KEY = ["tools"] as const;
const CODEX_CAPABILITY_USE_CASE_PATH = "docs/engineering/CODEX_CAPABILITY_USE_CASE.md";

function riskTone(risk: string | undefined): "neutral" | "warning" | "danger" {
  if (risk === "high") return "danger";
  if (risk === "medium") return "warning";
  return "neutral";
}

/** Governed tool registry: discover /api/tools and run a bounded invocation. */
export function ToolsView() {
  const { data: state } = useConsoleState();
  const selectedToolName = useUiStore((s) => s.selectedToolName);
  const setSelectedToolName = useUiStore((s) => s.setSelectedToolName);

  const { data, isLoading, error } = useQuery({
    queryKey: TOOLS_KEY,
    queryFn: () => api.listTools(),
    refetchInterval: 2000,
  });

  const tools = data?.tools ?? [];
  const worktrees = state?.worktrees ?? [];
  const projects = state?.projects ?? [];
  const deviceOnline = state?.device?.status === "online";
  const codexTools = codexCapabilityTools(tools);
  const codexCliAgents = (state?.agents ?? []).filter(isCodexCliAgent);
  const showCodexCapabilityCase = codexTools.length > 0 || codexCliAgents.length > 0;

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow="Governed"
        title="Tools"
        description="Discover the governed tools this control plane exposes and run a bounded invocation. Raw wrapper commands stay server-side."
      />

      {!deviceOnline ? (
        <p className="text-xs text-warning">
          These tools run on the local device — start Desktop Bridge to bring it online before invoking.
        </p>
      ) : null}

      {showCodexCapabilityCase ? (
        <CodexCapabilityCase
          tools={codexTools}
          codexCliAgents={codexCliAgents}
          worktrees={worktrees}
          projects={projects}
          deviceOnline={deviceOnline}
          reviewFindings={state?.reviewFindings ?? []}
          codexChangePlans={state?.codexChangePlans ?? []}
          codexPatchProposals={state?.codexPatchProposals ?? []}
          approvalRequests={state?.approvalRequests ?? []}
          invocations={state?.invocations ?? []}
        />
      ) : null}

      {error ? (
        <EmptyState title="Could not load tools" hint={error instanceof Error ? error.message : "Request failed."} />
      ) : !tools.length ? (
        <EmptyState
          title={isLoading ? "Loading tools…" : "No governed tools available"}
          hint={isLoading ? undefined : "Register a governed ccusage or diff-review agent to expose a tool."}
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {tools.map((tool) => (
            <ToolCard
              key={tool.name}
              tool={tool}
              worktrees={worktrees}
              projects={projects}
              deviceOnline={deviceOnline}
              selected={selectedToolName === tool.name}
              onSelect={() => setSelectedToolName(tool.name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function codexCapabilityTools(tools: ToolDescriptor[]) {
  const names = new Set<string>(CODEX_TOOL_NAMES);
  return tools.filter((tool) => names.has(tool.name));
}

export function isCodexCliAgent(agent: AgentSnapshot) {
  const haystack = [
    agent.id,
    agent.name,
    agent.adapter?.command,
    ...(agent.adapter?.args ?? []),
  ].filter(Boolean).join(" ");
  return /\bcodex\b/i.test(haystack);
}

function codexToolReady(tool?: ToolDescriptor | null) {
  return Boolean(tool)
    && Boolean(tool?.agents?.length)
    && !(tool?.agents ?? []).every((agent) => agent.status === "disabled");
}

function newestByCreatedAt<T extends { createdAt?: string | null }>(items: T[]) {
  return [...items].sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")))[0] ?? null;
}

function codexInvocationSummary(invocation?: InvocationSnapshot | null) {
  if (!invocation) return null;
  return invocation.result?.summary
    ?? invocation.explanation?.summary
    ?? invocation.explanation?.reason
    ?? null;
}

function codexRunTerminal(status?: string | null) {
  return ["succeeded", "failed", "rejected", "cancelled", "timed_out", "expired"].includes(status ?? "");
}

function codexRunNextAction(invocation?: InvocationSnapshot | null, error?: string | null) {
  const haystack = [
    error,
    invocation?.result?.summary,
    invocation?.explanation?.summary,
    invocation?.explanation?.reason,
    invocation?.explanation?.nextAction,
  ].filter(Boolean).join(" ");
  if (/agent_not_available|No backing agent/i.test(haystack)) {
    return "Register the governed Codex agent for this tool, then refresh Tools and retry.";
  }
  if (/Desktop Bridge|local device|bridge.*offline/i.test(haystack)) {
    return "Start the full local stack with pnpm dev and confirm Desktop Bridge is online.";
  }
  if (/worktree_not_found|project_not_found/i.test(haystack)) {
    return "Select a visible project worktree, then run the check again.";
  }
  if (/approval_required|waiting_for_local_approval/i.test(haystack)) {
    return "Approve the local request, then retry the approval-gated action.";
  }
  if (/MODULE_NOT_FOUND|codex.*not found|ENOENT|not recognized|command not found/i.test(haystack)) {
    return "Install or re-register the governed Codex wrapper so the local runner can resolve Codex.";
  }
  if (/auth|login|401|Unauthorized/i.test(haystack)) {
    return "Confirm the local Codex CLI is logged in, then retry the run.";
  }
  if (invocation?.status === "queued" || invocation?.status === "dispatching" || invocation?.status === "running") {
    return "Keep this panel open; latest evidence refreshes after the local Codex run completes.";
  }
  if (invocation?.status === "failed" || invocation?.status === "rejected" || invocation?.status === "timed_out") {
    return "Open the invocation timeline for logs, fix the setup or input issue, then retry.";
  }
  return null;
}

function latestToolInvocation(invocations: InvocationSnapshot[], toolName: string, worktree?: WorktreeSnapshot | null) {
  const matches = invocations.filter((invocation) => {
    const metadata = invocation.options?.metadata ?? {};
    if (metadata.tool !== toolName) return false;
    if (!worktree) return true;
    const invocationWorktreeId = invocation.worktreeId ?? metadata.worktreeId;
    const invocationProjectId = invocation.projectId ?? metadata.projectId;
    return invocationWorktreeId === worktree.id && (!invocationProjectId || invocationProjectId === worktree.projectId);
  });
  return newestByCreatedAt(matches);
}

function pendingCodexApplyApproval(
  approvalRequests: ApprovalSnapshot[],
  invocations: InvocationSnapshot[],
  localApprovalRequestId?: string | null,
) {
  const invocationById = new Map(invocations.map((invocation) => [invocation.id, invocation]));
  const pending = approvalRequests.find((approval) => {
    if (!["pending", "waiting", "waiting_for_local_approval"].includes(approval.status)) return false;
    const invocation = approval.invocationId ? invocationById.get(approval.invocationId) : null;
    return invocation?.options?.metadata?.tool === "codex.apply.patch";
  });
  if (pending) return pending;
  return localApprovalRequestId
    ? approvalRequests.find((approval) => approval.id === localApprovalRequestId) ?? null
    : null;
}

type CodexOperationRow =
  | {
    kind: "proposal_review";
    id: string;
    title: string;
    detail: string;
    proposal: CodexPatchProposal;
  }
  | {
    kind: "apply_approval";
    id: string;
    title: string;
    detail: string;
    approvalRequestId: string;
    proposal: CodexPatchProposal;
    projectId?: string | null;
    worktreeId?: string | null;
    invocationId?: string | null;
  }
  | {
    kind: "blocked_run";
    id: string;
    title: string;
    detail: string;
    invocationId: string;
    status?: string | null;
  }
  | {
    kind: "applied_patch";
    id: string;
    title: string;
    detail: string;
    invocationId?: string | null;
  };

function codexOperationsQueue({
  proposals,
  invocations,
  approvalRequests,
  selectedWorktree,
  localApprovalRequestId,
  localApplyProposal,
}: {
  proposals: CodexPatchProposal[];
  invocations: InvocationSnapshot[];
  approvalRequests: ApprovalSnapshot[];
  selectedWorktree?: WorktreeSnapshot | null;
  localApprovalRequestId?: string | null;
  localApplyProposal?: CodexPatchProposal | null;
}): CodexOperationRow[] {
  const proposalById = new Map(proposals.map((proposal) => [proposal.id, proposal]));
  const invocationById = new Map(invocations.map((invocation) => [invocation.id, invocation]));
  const rows: CodexOperationRow[] = [];

  for (const proposal of sortNewest(proposals).filter((item) => ["generated", "reviewed"].includes(item.reviewState)).slice(0, 4)) {
    rows.push({
      kind: "proposal_review",
      id: `proposal:${proposal.id}`,
      title: "Review patch proposal",
      detail: `${proposal.id} · ${proposal.files.length} file(s) · ${proposal.summary ?? "No summary"}`,
      proposal,
    });
  }

  for (const approval of approvalRequests) {
    if (!["pending", "waiting", "waiting_for_local_approval"].includes(approval.status)) continue;
    const invocation = approval.invocationId ? invocationById.get(approval.invocationId) : null;
    const metadata = invocation?.options?.metadata ?? {};
    if (metadata.tool !== "codex.apply.patch") continue;
    if (selectedWorktree && metadata.worktreeId !== selectedWorktree.id) continue;
    const proposalId = stringValue(metadata.proposalId);
    const proposal = proposalId ? proposalById.get(proposalId) : null;
    if (!proposal) continue;
    rows.push({
      kind: "apply_approval",
      id: `approval:${approval.id}`,
      title: "Approve and retry patch apply",
      detail: `${approval.id} · ${proposal.id} · ${proposal.summary ?? "Approved patch proposal"}`,
      approvalRequestId: approval.id,
      proposal,
      projectId: stringValue(metadata.projectId) ?? proposal.projectId,
      worktreeId: stringValue(metadata.worktreeId) ?? proposal.worktreeId,
      invocationId: invocation?.id ?? approval.invocationId ?? null,
    });
  }

  if (localApprovalRequestId && localApplyProposal && !rows.some((row) => row.kind === "apply_approval" && row.approvalRequestId === localApprovalRequestId)) {
    rows.push({
      kind: "apply_approval",
      id: `approval:${localApprovalRequestId}`,
      title: "Approve and retry patch apply",
      detail: `${localApprovalRequestId} · ${localApplyProposal.id} · ${localApplyProposal.summary ?? "Approved patch proposal"}`,
      approvalRequestId: localApprovalRequestId,
      proposal: localApplyProposal,
      projectId: localApplyProposal.projectId,
      worktreeId: localApplyProposal.worktreeId,
      invocationId: null,
    });
  }

  for (const invocation of sortNewest(invocations).filter((item) => {
    const tool = stringValue(item.options?.metadata?.tool);
    if (!tool || !CODEX_TOOL_NAMES.includes(tool as (typeof CODEX_TOOL_NAMES)[number])) return false;
    if (!isInvocationFailure(item)) return false;
    if (!selectedWorktree) return true;
    const worktreeId = item.worktreeId ?? stringValue(item.options?.metadata?.worktreeId);
    return worktreeId === selectedWorktree.id;
  }).slice(0, 3)) {
    rows.push({
      kind: "blocked_run",
      id: `blocked:${invocation.id}`,
      title: "Inspect blocked Codex run",
      detail: `${stringValue(invocation.options?.metadata?.tool) ?? "codex"} · ${readableStatus(invocation.status ?? "failed")} · ${codexInvocationSummary(invocation) ?? "Open timeline for details"}`,
      invocationId: invocation.id,
      status: invocation.status,
    });
  }

  for (const proposal of sortNewest(proposals).filter((item) => item.reviewState === "applied").slice(0, 2)) {
    rows.push({
      kind: "applied_patch",
      id: `applied:${proposal.id}`,
      title: "Recent applied patch",
      detail: `${proposal.id} · ${proposal.applySummary ?? proposal.summary ?? "Patch applied"}`,
      invocationId: proposal.appliedInvocationId,
    });
  }

  return rows.slice(0, 10);
}

function sortNewest<T extends { createdAt?: string | null; appliedAt?: string | null }>(items: T[]) {
  return [...items].sort((a, b) => String(b.appliedAt ?? b.createdAt ?? "").localeCompare(String(a.appliedAt ?? a.createdAt ?? "")));
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function CodexCapabilityCase({
  tools,
  codexCliAgents,
  worktrees,
  projects,
  deviceOnline,
  reviewFindings,
  codexChangePlans,
  codexPatchProposals,
  approvalRequests,
  invocations,
}: {
  tools: ToolDescriptor[];
  codexCliAgents: AgentSnapshot[];
  worktrees: WorktreeSnapshot[];
  projects: ProjectSnapshot[];
  deviceOnline: boolean;
  reviewFindings: ReviewFinding[];
  codexChangePlans: CodexChangePlan[];
  codexPatchProposals: CodexPatchProposal[];
  approvalRequests: ApprovalSnapshot[];
  invocations: InvocationSnapshot[];
}) {
  const toolByName = useMemo(() => new Map(tools.map((tool) => [tool.name, tool])), [tools]);
  const reviewTool = toolByName.get("codex.review.diff");
  const planTool = toolByName.get("codex.plan.change");
  const proposalTool = toolByName.get("codex.propose.patch");
  const applyTool = toolByName.get("codex.apply.patch");
  const readyCount = CODEX_TOOL_NAMES.filter((name) => codexToolReady(toolByName.get(name))).length;
  const codexCliReady = codexCliAgents.some((agent) => agent.status === "available");
  const codexFindings = reviewFindings.filter((finding) => finding.source === "codex" || finding.tool === "codex.review.diff");
  const latestFinding = newestByCreatedAt(codexFindings);
  const [worktreeId, setWorktreeId] = useState(worktrees[0]?.id ?? "");
  const [goal, setGoal] = useState("Plan the next safe productization step for this worktree.");
  const [proposalConstraints, setProposalConstraints] = useState("Do not apply the patch. Return a bounded reviewable diff artifact.");
  const [proposalMaxFiles, setProposalMaxFiles] = useState("4");
  const [copiedUseCasePath, setCopiedUseCasePath] = useState(false);
  const reviewInvoke = useToolInvoke();
  const planInvoke = useToolInvoke();
  const proposalInvoke = useToolInvoke();
  const applyInvoke = useToolInvoke();
  const approveApply = useApprovalAction();
  const proposalReview = useCodexProposalReviewAction();
  const selectedToolName = useUiStore((s) => s.selectedToolName);
  const selectedToolFocus = useUiStore((s) => s.selectedToolFocus);
  const setSelectedInvocationId = useUiStore((s) => s.setSelectedInvocationId);
  const setSection = useUiStore((s) => s.setSection);
  const opsQueueRef = useRef<HTMLDivElement | null>(null);
  const createdReviewInvocation = reviewInvoke.invocationId
    ? invocations.find((invocation) => invocation.id === reviewInvoke.invocationId) ?? null
    : null;
  const createdPlanInvocation = planInvoke.invocationId
    ? invocations.find((invocation) => invocation.id === planInvoke.invocationId) ?? null
    : null;
  const createdProposalInvocation = proposalInvoke.invocationId
    ? invocations.find((invocation) => invocation.id === proposalInvoke.invocationId) ?? null
    : null;
  const createdApplyInvocation = applyInvoke.invocationId
    ? invocations.find((invocation) => invocation.id === applyInvoke.invocationId) ?? null
    : null;

  const projectName = useMemo(() => {
    const map = new Map(projects.map((project) => [project.id, project.name]));
    return (id: string) => map.get(id) ?? id;
  }, [projects]);

  useEffect(() => {
    if (!worktrees.some((worktree) => worktree.id === worktreeId)) {
      setWorktreeId(worktrees[0]?.id ?? "");
    }
  }, [worktrees, worktreeId]);

  useEffect(() => {
    if (selectedToolName === "codex" && selectedToolFocus === "ops") {
      opsQueueRef.current?.scrollIntoView({ block: "start" });
    }
  }, [selectedToolFocus, selectedToolName]);

  const selectedWorktree = worktrees.find((worktree) => worktree.id === worktreeId) ?? null;
  const selectedPlans = useMemo(
    () => selectedWorktree
      ? codexChangePlans.filter((plan) => plan.projectId === selectedWorktree.projectId && plan.worktreeId === selectedWorktree.id)
      : [],
    [codexChangePlans, selectedWorktree],
  );
  const selectedProposals = useMemo(
    () => selectedWorktree
      ? codexPatchProposals.filter((proposal) => proposal.projectId === selectedWorktree.projectId && proposal.worktreeId === selectedWorktree.id)
      : [],
    [codexPatchProposals, selectedWorktree],
  );
  const selectedFindings = useMemo(
    () => selectedWorktree
      ? codexFindings.filter((finding) => finding.projectId === selectedWorktree.projectId && finding.worktreeId === selectedWorktree.id)
      : [],
    [codexFindings, selectedWorktree],
  );
  const latestSelectedFinding = newestByCreatedAt(selectedFindings);
  const latestPlan = newestByCreatedAt(selectedPlans) ?? newestByCreatedAt(codexChangePlans);
  const latestProposal = newestByCreatedAt(selectedProposals) ?? newestByCreatedAt(codexPatchProposals);
  const latestSelectedProposal = newestByCreatedAt(selectedProposals);
  const selectedApprovedProposal = selectedProposals.find((proposal) => proposal.reviewState === "approved") ?? null;
  const latestReviewInvocation = latestToolInvocation(invocations, "codex.review.diff", selectedWorktree);
  const latestPlanInvocation = latestToolInvocation(invocations, "codex.plan.change", selectedWorktree);
  const latestProposalInvocation = latestToolInvocation(invocations, "codex.propose.patch", selectedWorktree);
  const latestApplyInvocation = latestToolInvocation(invocations, "codex.apply.patch", selectedWorktree);
  const pendingApplyApproval = pendingCodexApplyApproval(approvalRequests, invocations, applyInvoke.approvalRequestId);
  const operationsQueue = useMemo(
    () => codexOperationsQueue({
      proposals: selectedWorktree ? selectedProposals : codexPatchProposals,
      invocations,
      approvalRequests,
      selectedWorktree,
      localApprovalRequestId: applyInvoke.approvalRequestId,
      localApplyProposal: selectedApprovedProposal,
    }),
    [approvalRequests, applyInvoke.approvalRequestId, codexPatchProposals, invocations, selectedApprovedProposal, selectedProposals, selectedWorktree],
  );
  const runDisabled = !deviceOnline || !selectedWorktree;

  function runReview() {
    if (!selectedWorktree || !reviewTool) return;
    void reviewInvoke.invoke(reviewTool.name, {
      projectId: selectedWorktree.projectId,
      worktreeId: selectedWorktree.id,
      severityFloor: "medium",
      instruction: "Focus on correctness, regressions, and missing tests.",
    });
  }

  function runPlan() {
    if (!selectedWorktree || !planTool) return;
    void planInvoke.invoke(planTool.name, {
      projectId: selectedWorktree.projectId,
      worktreeId: selectedWorktree.id,
      goal: goal.trim() || "Plan the next safe productization step for this worktree.",
      constraints: "Do not write files. Return a bounded implementation plan and verification steps.",
      severityFloor: "medium",
    });
  }

  function runProposal() {
    if (!selectedWorktree || !proposalTool) return;
    const maxFiles = Math.max(1, Math.min(25, Number(proposalMaxFiles) || 4));
    void proposalInvoke.invoke(proposalTool.name, {
      projectId: selectedWorktree.projectId,
      worktreeId: selectedWorktree.id,
      goal: goal.trim() || "Generate a reviewable patch proposal for this worktree.",
      constraints: proposalConstraints.trim() || "Do not apply the patch.",
      ...(latestPlan?.id ? { basePlanId: latestPlan.id } : {}),
      maxFiles,
    });
  }

  async function requestApply() {
    if (!selectedWorktree || !applyTool || !selectedApprovedProposal) return;
    await applyInvoke.invoke(applyTool.name, {
      projectId: selectedWorktree.projectId,
      worktreeId: selectedWorktree.id,
      proposalId: selectedApprovedProposal.id,
      patchSha256: selectedApprovedProposal.patchSha256,
    });
  }

  async function approveAndRetryApply() {
    if (!selectedWorktree || !applyTool || !selectedApprovedProposal || !applyInvoke.approvalRequestId) return;
    await approveAndRetryApplyRequest(applyInvoke.approvalRequestId, selectedApprovedProposal, {
      projectId: selectedWorktree.projectId,
      worktreeId: selectedWorktree.id,
    });
  }

  async function approveAndRetryApplyRequest(
    approvalRequestId: string,
    proposal: CodexPatchProposal,
    scope: { projectId?: string | null; worktreeId?: string | null },
  ) {
    if (!applyTool || !scope.projectId || !scope.worktreeId) return;
    const approved = await approveApply.approve(approvalRequestId);
    if (!approved) return;
    await applyInvoke.invoke(applyTool.name, {
      projectId: scope.projectId,
      worktreeId: scope.worktreeId,
      proposalId: proposal.id,
      patchSha256: proposal.patchSha256,
      approvalRequestId,
    });
  }

  function viewInvocation(invocationId: string) {
    setSelectedInvocationId(invocationId);
    setSection("invocations");
  }

  function copyUseCasePath() {
    void navigator.clipboard?.writeText(CODEX_CAPABILITY_USE_CASE_PATH);
    setCopiedUseCasePath(true);
  }

  const nextAction = !deviceOnline
    ? "Start Desktop Bridge before invoking Codex-backed tools."
    : !worktrees.length
      ? "Create or select a project worktree before running review or planning."
      : !codexCliReady
        ? "Register or enable a local Codex CLI agent before invoking the governed tools."
      : readyCount < 2
        ? "Register the governed Codex review and plan agents to run the safe checks."
        : !latestFinding && !latestPlan
          ? "Run diff review or change plan once to create inspectable evidence."
          : latestProposal && latestProposal.reviewState !== "applied"
            ? "Review the latest patch proposal before any approval-gated apply step."
            : "Use latest evidence to decide whether a patch proposal is warranted.";

  return (
    <Card data-tool-panel="codex-capability-case">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <CardTitle>Codex capability case</CardTitle>
            <p className="text-xs text-muted-foreground">
              Governed Codex tools are checked as a capability suite: review, plan, propose, and approval-gated apply.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={copyUseCasePath}>
              <Clipboard />
              Copy use case path
            </Button>
            {copiedUseCasePath ? <span className="text-xs text-success">Copied use case path.</span> : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={readyCount >= 2 ? "success" : "warning"}>{readyCount}/4 ready</Badge>
          <Badge tone={codexCliReady ? "success" : "warning"}>{codexCliReady ? "Codex CLI available" : "Codex CLI missing"}</Badge>
          <Badge tone="neutral">governed tool suite</Badge>
          <Badge tone="neutral">no raw Codex CLI</Badge>
          {latestPlan ? <Badge tone="success">latest plan</Badge> : null}
          {latestProposal ? <Badge tone="warning">patch proposal evidence</Badge> : null}
        </div>

        <div className="grid gap-2 md:grid-cols-4">
          <CodexReadinessItem
            label="Desktop Bridge"
            ready={deviceOnline}
            detail={deviceOnline ? "Online" : "Offline"}
          />
          <CodexReadinessItem
            label="Codex CLI agent"
            ready={codexCliReady}
            detail={codexCliReady ? `${codexCliAgents.length} discovered` : "No available Codex CLI agent"}
          />
          <CodexReadinessItem
            label="Governed facades"
            ready={readyCount >= 2}
            detail={`${readyCount}/4 registered`}
          />
          <CodexReadinessItem
            label="Worktree"
            ready={worktrees.length > 0}
            detail={worktrees.length ? `${worktrees.length} selectable` : "No worktree in state"}
          />
        </div>

        <div className="grid gap-2 md:grid-cols-4">
          {CODEX_TOOL_NAMES.map((name) => {
            const tool = toolByName.get(name);
            return (
              <div key={name} className="rounded-md border border-border bg-muted/20 p-3 text-xs">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] text-foreground">{name.replace("codex.", "")}</span>
                  <Badge tone={codexToolReady(tool) ? "success" : "warning"}>
                    {codexToolReady(tool) ? "Ready" : "Missing"}
                  </Badge>
                </div>
                <p className="text-muted-foreground">{tool?.outputCollection ?? "Not registered"}</p>
              </div>
            );
          })}
        </div>

        <CodexLifecycleRail
          latestFinding={latestSelectedFinding ?? latestFinding}
          latestPlan={latestPlan}
          latestProposal={latestSelectedProposal ?? latestProposal}
          latestReviewInvocation={latestReviewInvocation ?? createdReviewInvocation}
          latestPlanInvocation={latestPlanInvocation ?? createdPlanInvocation}
          latestProposalInvocation={latestProposalInvocation ?? createdProposalInvocation}
          latestApplyInvocation={latestApplyInvocation ?? createdApplyInvocation}
          pendingApplyApproval={pendingApplyApproval}
          approvalRequestId={applyInvoke.approvalRequestId}
          approvedProposal={selectedApprovedProposal}
        />

        <div
          ref={opsQueueRef}
          className={cn(selectedToolName === "codex" && selectedToolFocus === "ops" && "rounded-lg ring-2 ring-warning/40 ring-offset-2 ring-offset-background")}
        >
          <CodexOperationsQueue
            rows={operationsQueue}
            busy={proposalReview.pending || approveApply.pending || applyInvoke.pending}
            reviewError={proposalReview.error}
            approvalError={approveApply.error}
            onReview={proposalReview.review}
            onApproveAndRetry={(row) => approveAndRetryApplyRequest(row.approvalRequestId, row.proposal, {
              projectId: row.projectId,
              worktreeId: row.worktreeId,
            })}
            onViewInvocation={viewInvocation}
          />
        </div>

        <div className="grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-3 rounded-md border border-border bg-background p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Worktree">
                <Select value={worktreeId} onChange={(event) => setWorktreeId(event.target.value)}>
                  {!worktrees.length ? <option value="">No worktrees available</option> : null}
                  {worktrees.map((worktree) => (
                    <option key={worktree.id} value={worktree.id}>
                      {worktree.branch} · {projectName(worktree.projectId)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Plan goal">
                <Textarea
                  value={goal}
                  maxLength={2000}
                  onChange={(event) => setGoal(event.target.value)}
                />
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={runReview} disabled={runDisabled || !codexToolReady(reviewTool) || reviewInvoke.pending}>
                <Play />
                {reviewInvoke.pending ? "Starting..." : "Run diff review"}
              </Button>
              <Button size="sm" variant="secondary" onClick={runPlan} disabled={runDisabled || !codexToolReady(planTool) || planInvoke.pending}>
                <ListChecks />
                {planInvoke.pending ? "Starting..." : "Run change plan"}
              </Button>
            </div>
            <CodexRunStatus
              label="Diff review run"
              invocationId={reviewInvoke.invocationId}
              invocation={createdReviewInvocation}
              error={reviewInvoke.error}
              outputCollection={reviewTool?.outputCollection}
              onView={reviewInvoke.viewInvocation}
            />
            <CodexRunStatus
              label="Change plan run"
              invocationId={planInvoke.invocationId}
              invocation={createdPlanInvocation}
              error={planInvoke.error}
              outputCollection={planTool?.outputCollection}
              onView={planInvoke.viewInvocation}
            />
            <p className="text-xs text-muted-foreground">Next: {nextAction}</p>
          </div>

          <div className="space-y-2 rounded-md border border-border bg-background p-3 text-xs">
            <CodexEvidenceRow
              icon={<GitPullRequestArrow />}
              label="Latest review finding"
              value={latestFinding ? `${latestFinding.severity}: ${latestFinding.file}` : "No Codex review finding yet"}
              detail={latestFinding?.message}
            />
            <CodexEvidenceRow
              icon={<ListChecks />}
              label="Latest change plan"
              value={latestPlan?.summary ?? "No Codex change plan yet"}
              detail={latestPlan ? `${latestPlan.steps.length} step(s), ${latestPlan.verification.length} verification item(s)` : null}
            />
            <CodexEvidenceRow
              icon={<FileText />}
              label="Latest patch proposal"
              value={latestProposal?.summary ?? "No Codex patch proposal yet"}
              detail={latestProposal ? `${latestProposal.files.length} file(s), review state ${latestProposal.reviewState}` : null}
            />
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-3 rounded-md border border-border bg-background p-3">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
              <Field label="Proposal constraints">
                <Textarea
                  value={proposalConstraints}
                  maxLength={2000}
                  onChange={(event) => setProposalConstraints(event.target.value)}
                />
              </Field>
              <Field label="Max files">
                <Input
                  type="number"
                  min="1"
                  max="25"
                  value={proposalMaxFiles}
                  onChange={(event) => setProposalMaxFiles(event.target.value)}
                />
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={runProposal}
                disabled={runDisabled || !codexToolReady(proposalTool) || proposalInvoke.pending}
              >
                <FileText />
                {proposalInvoke.pending ? "Starting..." : "Generate patch proposal"}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void requestApply()}
                disabled={runDisabled || !codexToolReady(applyTool) || !selectedApprovedProposal || applyInvoke.pending}
              >
                <ShieldCheck />
                {applyInvoke.pending ? "Requesting..." : "Apply approved patch"}
              </Button>
              {applyInvoke.approvalRequestId ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={approveApply.pending || applyInvoke.pending}
                  onClick={() => void approveAndRetryApply()}
                >
                  <CheckCircle2 />
                  {approveApply.pending ? "Approving..." : "Approve and retry apply"}
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {latestPlan?.id ? `Base plan: ${latestPlan.id}.` : "No same-worktree plan yet; proposal can still run without a base plan."}
            </p>
            {!selectedApprovedProposal ? (
              <p className="text-xs text-warning">
                Apply is enabled only after a same-worktree proposal has review state approved.
              </p>
            ) : null}
            <CodexRunStatus
              label="Patch proposal run"
              invocationId={proposalInvoke.invocationId}
              invocation={createdProposalInvocation}
              error={proposalInvoke.error}
              outputCollection={proposalTool?.outputCollection}
              onView={proposalInvoke.viewInvocation}
            />
            <CodexRunStatus
              label="Patch apply run"
              invocationId={applyInvoke.invocationId}
              invocation={createdApplyInvocation}
              error={applyInvoke.error}
              outputCollection={applyTool?.outputCollection}
              onView={applyInvoke.viewInvocation}
            />
            {applyInvoke.approvalRequestId && !createdApplyInvocation ? (
              <p className="text-xs text-muted-foreground">
                Approval requested: <span className="font-mono text-foreground">{applyInvoke.approvalRequestId}</span>.
              </p>
            ) : null}
            {approveApply.error ? <p className="text-xs text-destructive">{approveApply.error}</p> : null}
          </div>

          <CodexProposalReview
            proposal={latestSelectedProposal}
            reviewPending={proposalReview.pending}
            reviewError={proposalReview.error}
            onReview={proposalReview.review}
          />
        </div>
      </CardContent>
    </Card>
  );
}

type CodexLifecycleStatus = "done" | "active" | "waiting" | "blocked" | "empty";

interface CodexLifecycleStep {
  key: string;
  label: string;
  status: CodexLifecycleStatus;
  value: string;
  detail?: string | null;
  icon: React.ReactNode;
}

function CodexLifecycleRail({
  latestFinding,
  latestPlan,
  latestProposal,
  latestReviewInvocation,
  latestPlanInvocation,
  latestProposalInvocation,
  latestApplyInvocation,
  pendingApplyApproval,
  approvalRequestId,
  approvedProposal,
}: {
  latestFinding?: ReviewFinding | null;
  latestPlan?: CodexChangePlan | null;
  latestProposal?: CodexPatchProposal | null;
  latestReviewInvocation?: InvocationSnapshot | null;
  latestPlanInvocation?: InvocationSnapshot | null;
  latestProposalInvocation?: InvocationSnapshot | null;
  latestApplyInvocation?: InvocationSnapshot | null;
  pendingApplyApproval?: ApprovalSnapshot | null;
  approvalRequestId?: string | null;
  approvedProposal?: CodexPatchProposal | null;
}) {
  const localApprovalId = pendingApplyApproval?.id ?? approvalRequestId ?? null;
  const steps: CodexLifecycleStep[] = [
    {
      key: "review",
      label: "Review evidence",
      status: codexEvidenceStepStatus(latestReviewInvocation, Boolean(latestFinding)),
      value: latestFinding ? `${latestFinding.severity}: ${latestFinding.file}` : lifecycleInvocationValue(latestReviewInvocation, "No review evidence"),
      detail: latestFinding?.message ?? codexInvocationSummary(latestReviewInvocation),
      icon: <GitPullRequestArrow />,
    },
    {
      key: "plan",
      label: "Change plan",
      status: codexEvidenceStepStatus(latestPlanInvocation, Boolean(latestPlan)),
      value: latestPlan?.summary ?? lifecycleInvocationValue(latestPlanInvocation, "No change plan"),
      detail: latestPlan ? `${latestPlan.steps.length} step(s), ${latestPlan.verification.length} verification item(s)` : codexInvocationSummary(latestPlanInvocation),
      icon: <ListChecks />,
    },
    {
      key: "proposal",
      label: "Patch proposal",
      status: codexProposalStepStatus(latestProposal, latestProposalInvocation),
      value: codexProposalStepValue(latestProposal, latestProposalInvocation),
      detail: latestProposal?.summary ?? codexInvocationSummary(latestProposalInvocation),
      icon: <FileText />,
    },
    {
      key: "apply",
      label: localApprovalId ? "Local apply approval" : "Patch apply",
      status: codexApplyStepStatus({ latestProposal, latestApplyInvocation, localApprovalId, approvedProposal }),
      value: codexApplyStepValue({ latestProposal, latestApplyInvocation, localApprovalId, approvedProposal }),
      detail: localApprovalId
        ? `Approval request ${localApprovalId}`
        : latestProposal?.applySummary ?? codexInvocationSummary(latestApplyInvocation),
      icon: localApprovalId ? <ShieldAlert /> : <ShieldCheck />,
    },
  ];

  return (
    <div className="space-y-2 rounded-md border border-border bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">Codex lifecycle</p>
        <Badge tone={lifecycleRailTone(steps)}>{lifecycleRailLabel(steps)}</Badge>
      </div>
      <div className="grid gap-2 md:grid-cols-4">
        {steps.map((step) => (
          <CodexLifecycleStepCard key={step.key} step={step} />
        ))}
      </div>
    </div>
  );
}

function CodexOperationsQueue({
  rows,
  busy,
  reviewError,
  approvalError,
  onReview,
  onApproveAndRetry,
  onViewInvocation,
}: {
  rows: CodexOperationRow[];
  busy: boolean;
  reviewError: string | null;
  approvalError: string | null;
  onReview: (proposalId: string, action: "approve" | "reject") => Promise<boolean | undefined>;
  onApproveAndRetry: (row: Extract<CodexOperationRow, { kind: "apply_approval" }>) => Promise<void>;
  onViewInvocation: (invocationId: string) => void;
}) {
  const attentionCount = rows.filter((row) => row.kind !== "applied_patch").length;
  return (
    <div className="space-y-2 rounded-md border border-border bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-foreground">Operations queue</p>
          <p className="text-xs text-muted-foreground">Codex items that need review, approval, recovery, or recent audit follow-up.</p>
        </div>
        <Badge tone={attentionCount ? "warning" : rows.length ? "success" : "neutral"}>
          {attentionCount ? `${attentionCount} pending` : rows.length ? "Recent activity" : "Clear"}
        </Badge>
      </div>
      {rows.length ? (
        <div className="space-y-2">
          {rows.map((row) => (
            <CodexOperationRowItem
              key={row.id}
              row={row}
              busy={busy}
              onReview={onReview}
              onApproveAndRetry={onApproveAndRetry}
              onViewInvocation={onViewInvocation}
            />
          ))}
        </div>
      ) : (
        <p className="rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
          No Codex operations need attention for the current worktree.
        </p>
      )}
      {reviewError ? <p className="text-xs text-destructive">{reviewError}</p> : null}
      {approvalError ? <p className="text-xs text-destructive">{approvalError}</p> : null}
    </div>
  );
}

function CodexOperationRowItem({
  row,
  busy,
  onReview,
  onApproveAndRetry,
  onViewInvocation,
}: {
  row: CodexOperationRow;
  busy: boolean;
  onReview: (proposalId: string, action: "approve" | "reject") => Promise<boolean | undefined>;
  onApproveAndRetry: (row: Extract<CodexOperationRow, { kind: "apply_approval" }>) => Promise<void>;
  onViewInvocation: (invocationId: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/20 p-3 text-xs">
      <div className="min-w-0">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <Badge tone={codexOperationTone(row.kind)}>{codexOperationLabel(row.kind)}</Badge>
          <span className="font-medium text-foreground">{row.title}</span>
        </div>
        <p className="[overflow-wrap:anywhere] text-muted-foreground">{row.detail}</p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {row.kind === "proposal_review" ? (
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => void onReview(row.proposal.id, "approve")}
            >
              <CheckCircle2 />
              Approve
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => void onReview(row.proposal.id, "reject")}
            >
              <XCircle />
              Reject
            </Button>
          </>
        ) : null}
        {row.kind === "apply_approval" ? (
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => void onApproveAndRetry(row)}
            >
              <ShieldCheck />
              Approve and retry
            </Button>
            {row.invocationId ? (
              <Button size="sm" variant="secondary" onClick={() => onViewInvocation(row.invocationId!)}>
                <GitPullRequestArrow />
                View
              </Button>
            ) : null}
          </>
        ) : null}
        {row.kind === "blocked_run" || row.kind === "applied_patch" ? (
          row.invocationId ? (
            <Button size="sm" variant="secondary" onClick={() => onViewInvocation(row.invocationId!)}>
              <GitPullRequestArrow />
              View invocation
            </Button>
          ) : null
        ) : null}
      </div>
    </div>
  );
}

function codexOperationTone(kind: CodexOperationRow["kind"]): "neutral" | "success" | "warning" | "danger" {
  if (kind === "blocked_run") return "danger";
  if (kind === "applied_patch") return "success";
  if (kind === "proposal_review" || kind === "apply_approval") return "warning";
  return "neutral";
}

function codexOperationLabel(kind: CodexOperationRow["kind"]) {
  if (kind === "proposal_review") return "Review";
  if (kind === "apply_approval") return "Approval";
  if (kind === "blocked_run") return "Blocked";
  return "Applied";
}

function CodexLifecycleStepCard({ step }: { step: CodexLifecycleStep }) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-muted/20 p-3 text-xs">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={cn("shrink-0 [&_svg]:size-4", lifecycleIconClass(step.status))}>{step.icon}</span>
          <span className="truncate font-medium text-foreground">{step.label}</span>
        </div>
        <Badge tone={lifecycleTone(step.status)}>{lifecycleStatusLabel(step.status)}</Badge>
      </div>
      <p className="[overflow-wrap:anywhere] font-medium text-foreground">{step.value}</p>
      {step.detail ? <p className="mt-1 [overflow-wrap:anywhere] text-muted-foreground">{step.detail}</p> : null}
    </div>
  );
}

function codexEvidenceStepStatus(invocation?: InvocationSnapshot | null, hasEvidence = false): CodexLifecycleStatus {
  if (hasEvidence) return "done";
  if (isInvocationActive(invocation)) return "active";
  if (isInvocationFailure(invocation)) return "blocked";
  return "empty";
}

function codexProposalStepStatus(proposal?: CodexPatchProposal | null, invocation?: InvocationSnapshot | null): CodexLifecycleStatus {
  if (proposal?.reviewState === "applied" || proposal?.reviewState === "approved") return "done";
  if (proposal?.reviewState === "rejected") return "blocked";
  if (proposal?.reviewState === "generated" || proposal?.reviewState === "reviewed") return "waiting";
  if (isInvocationActive(invocation)) return "active";
  if (isInvocationFailure(invocation)) return "blocked";
  return "empty";
}

function codexApplyStepStatus({
  latestProposal,
  latestApplyInvocation,
  localApprovalId,
  approvedProposal,
}: {
  latestProposal?: CodexPatchProposal | null;
  latestApplyInvocation?: InvocationSnapshot | null;
  localApprovalId?: string | null;
  approvedProposal?: CodexPatchProposal | null;
}): CodexLifecycleStatus {
  if (latestProposal?.reviewState === "applied") return "done";
  if (localApprovalId) return "waiting";
  if (isInvocationActive(latestApplyInvocation)) return "active";
  if (isInvocationFailure(latestApplyInvocation)) return "blocked";
  if (approvedProposal) return "waiting";
  return "empty";
}

function codexProposalStepValue(proposal?: CodexPatchProposal | null, invocation?: InvocationSnapshot | null) {
  if (!proposal) return lifecycleInvocationValue(invocation, "No patch proposal");
  if (proposal.reviewState === "applied") return "Applied";
  if (proposal.reviewState === "approved") return "Approved for apply";
  if (proposal.reviewState === "rejected") return "Rejected";
  if (proposal.reviewState === "generated" || proposal.reviewState === "reviewed") return "Awaiting proposal review";
  return proposal.reviewState;
}

function codexApplyStepValue({
  latestProposal,
  latestApplyInvocation,
  localApprovalId,
  approvedProposal,
}: {
  latestProposal?: CodexPatchProposal | null;
  latestApplyInvocation?: InvocationSnapshot | null;
  localApprovalId?: string | null;
  approvedProposal?: CodexPatchProposal | null;
}) {
  if (latestProposal?.reviewState === "applied") return "Patch applied";
  if (localApprovalId) return "Waiting for local approval";
  if (approvedProposal) return "Ready to request apply";
  return lifecycleInvocationValue(latestApplyInvocation, "Not requested");
}

function lifecycleInvocationValue(invocation?: InvocationSnapshot | null, fallback = "Not started") {
  if (!invocation) return fallback;
  return readableStatus(invocation.status ?? "queued");
}

function isInvocationActive(invocation?: InvocationSnapshot | null) {
  return ["queued", "dispatching", "running", "waiting_for_local_approval"].includes(invocation?.status ?? "");
}

function isInvocationFailure(invocation?: InvocationSnapshot | null) {
  return ["failed", "rejected", "timed_out", "expired", "cancelled"].includes(invocation?.status ?? "");
}

function lifecycleTone(status: CodexLifecycleStatus): "neutral" | "success" | "warning" | "danger" {
  if (status === "done") return "success";
  if (status === "blocked") return "danger";
  if (status === "active" || status === "waiting") return "warning";
  return "neutral";
}

function lifecycleIconClass(status: CodexLifecycleStatus) {
  if (status === "done") return "text-success";
  if (status === "blocked") return "text-destructive";
  if (status === "active" || status === "waiting") return "text-warning";
  return "text-muted-foreground";
}

function lifecycleStatusLabel(status: CodexLifecycleStatus) {
  if (status === "done") return "Done";
  if (status === "active") return "Running";
  if (status === "waiting") return "Waiting";
  if (status === "blocked") return "Blocked";
  return "Open";
}

function lifecycleRailTone(steps: CodexLifecycleStep[]): "neutral" | "success" | "warning" | "danger" {
  if (steps.some((step) => step.status === "blocked")) return "danger";
  if (steps.some((step) => step.status === "waiting" || step.status === "active")) return "warning";
  if (steps.every((step) => step.status === "done")) return "success";
  return "neutral";
}

function lifecycleRailLabel(steps: CodexLifecycleStep[]) {
  if (steps.some((step) => step.status === "blocked")) return "Needs attention";
  if (steps.some((step) => step.status === "waiting")) return "Action pending";
  if (steps.some((step) => step.status === "active")) return "Running";
  if (steps.every((step) => step.status === "done")) return "Complete";
  return "Ready to start";
}

function proposalTone(state?: string | null): "neutral" | "success" | "warning" | "danger" {
  if (state === "approved" || state === "applied") return "success";
  if (state === "rejected") return "danger";
  if (state === "generated" || state === "reviewed") return "warning";
  return "neutral";
}

function CodexProposalReview({
  proposal,
  reviewPending,
  reviewError,
  onReview,
}: {
  proposal?: CodexPatchProposal | null;
  reviewPending: boolean;
  reviewError: string | null;
  onReview: (proposalId: string, action: "approve" | "reject") => Promise<boolean | undefined>;
}) {
  if (!proposal) {
    return (
      <div className="rounded-md border border-border bg-background p-3 text-xs">
        <p className="font-medium text-foreground">Patch proposal review</p>
        <p className="mt-1 text-muted-foreground">No proposal for the selected worktree yet.</p>
      </div>
    );
  }
  const canApprove = ["generated", "reviewed"].includes(proposal.reviewState);
  const canReject = ["generated", "reviewed", "approved"].includes(proposal.reviewState);
  const showReviewActions = canApprove || canReject;
  return (
    <div className="space-y-3 rounded-md border border-border bg-background p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium text-foreground">Patch proposal review</p>
        <Badge tone={proposalTone(proposal.reviewState)}>{proposal.reviewState}</Badge>
        <Badge tone="neutral">{proposal.files.length} file(s)</Badge>
      </div>
      <div className="space-y-2">
        <CodexEvidenceRow icon={<FileText />} label="Proposal" value={proposal.id} detail={proposal.summary} />
        <CodexEvidenceRow icon={<ShieldCheck />} label="Patch SHA-256" value={proposal.patchSha256} />
        <CodexEvidenceRow
          icon={<ListChecks />}
          label="Verification"
          value={proposal.verification.length ? proposal.verification.join(" · ") : "No verification recorded"}
        />
      </div>
      {proposal.files.length ? (
        <div className="space-y-1">
          <p className="text-[11px] uppercase text-muted-foreground">Files</p>
          <div className="flex flex-wrap gap-1.5">
            {proposal.files.map((file) => (
              <Badge key={`${file.path}:${file.changeType}`} tone={riskTone(file.risk)}>
                {file.changeType} {file.path}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}
      {proposal.diffPreview ? (
        <pre className="max-h-40 overflow-auto rounded-md border border-border bg-muted/30 p-2 whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
          {proposal.diffPreview}
        </pre>
      ) : null}
      {showReviewActions ? (
        <div className="flex flex-wrap gap-2">
          {canApprove ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={reviewPending}
              onClick={() => void onReview(proposal.id, "approve")}
            >
              <CheckCircle2 />
              {reviewPending ? "Reviewing..." : "Approve proposal"}
            </Button>
          ) : null}
          {canReject ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={reviewPending}
              onClick={() => void onReview(proposal.id, "reject")}
            >
              <XCircle />
              {reviewPending ? "Reviewing..." : "Reject proposal"}
            </Button>
          ) : null}
        </div>
      ) : null}
      {reviewError ? <p className="text-destructive">{reviewError}</p> : null}
      <p className="text-muted-foreground">
        {proposal.reviewState === "approved"
          ? "This proposal is eligible for approval-gated apply."
          : proposal.reviewState === "applied"
            ? `Applied by ${proposal.appliedInvocationId ?? "a recorded invocation"}.`
            : "Review and approve this proposal before applying."}
      </p>
    </div>
  );
}

function CodexReadinessItem({
  label,
  ready,
  detail,
}: {
  label: string;
  ready: boolean;
  detail: string;
}) {
  return (
    <div className="rounded-md border border-border bg-background p-3 text-xs">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-medium text-foreground">{label}</span>
        <Badge tone={ready ? "success" : "warning"}>{ready ? "Ready" : "Action"}</Badge>
      </div>
      <p className="text-muted-foreground">{detail}</p>
    </div>
  );
}

function CodexRunStatus({
  label,
  invocationId,
  invocation,
  error,
  outputCollection,
  onView,
}: {
  label: string;
  invocationId: string | null;
  invocation?: InvocationSnapshot | null;
  error: string | null;
  outputCollection?: string;
  onView: () => void;
}) {
  if (!invocationId && !error) return null;
  const status = invocation?.status ?? (invocationId ? "queued" : "failed");
  const summary = codexInvocationSummary(invocation);
  const nextAction = codexRunNextAction(invocation, error);
  const isFailure = status === "failed" || status === "rejected" || status === "timed_out" || status === "expired";
  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/20 p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-foreground">{label}</span>
        <Badge tone={statusTone(status)}>{readableStatus(status)}</Badge>
        {invocationId ? <span className="font-mono text-[11px] text-foreground">{invocationId}</span> : null}
        {outputCollection ? <Badge tone="neutral">{outputCollection}</Badge> : null}
      </div>
      <p className={isFailure || error ? "text-destructive" : "text-muted-foreground"}>
        {error
          ?? summary
          ?? (codexRunTerminal(status)
            ? `Codex run finished with status ${readableStatus(status)}.`
            : `Codex run queued. Results import into ${outputCollection ?? "the configured collection"}.`)}
      </p>
      {nextAction ? <p className="text-muted-foreground">Next: {nextAction}</p> : null}
      {invocationId ? (
        <button type="button" className="font-medium text-primary hover:underline" onClick={onView}>
          View invocation →
        </button>
      ) : null}
    </div>
  );
}

function CodexEvidenceRow({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail?: string | null;
}) {
  return (
    <div className="grid grid-cols-[1rem_1fr] gap-2 border-b border-border/70 pb-2 last:border-0 last:pb-0">
      <span className="mt-0.5 text-muted-foreground [&_svg]:size-4">{icon}</span>
      <div className="min-w-0">
        <div className="text-[11px] uppercase text-muted-foreground">{label}</div>
        <div className="[overflow-wrap:anywhere] font-medium text-foreground">{value}</div>
        {detail ? <div className="[overflow-wrap:anywhere] text-muted-foreground">{detail}</div> : null}
      </div>
    </div>
  );
}

function ToolCard({
  tool,
  worktrees,
  projects,
  deviceOnline,
  selected,
  onSelect,
}: {
  tool: ToolDescriptor;
  worktrees: WorktreeSnapshot[];
  projects: ProjectSnapshot[];
  deviceOnline: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const isReview = tool.name === "codex.review.diff" || tool.name === "claude.review.diff";
  const isCcusage = tool.name === "ccusage.report";
  const disabledAgents = (tool.agents ?? []).every((agent) => agent.status === "disabled");
  const noAgents = !(tool.agents ?? []).length;

  return (
    <Card
      onClick={onSelect}
      onFocusCapture={onSelect}
      className={cn("cursor-pointer transition-colors", selected && "border-primary/50")}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle>{tool.displayName}</CardTitle>
          <span className="text-xs text-muted-foreground">v{tool.version}</span>
        </div>
        {tool.description ? (
          <p className="text-sm text-muted-foreground">{tool.description}</p>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={riskTone(tool.riskLevel)}>Risk: {tool.riskLevel ?? "unknown"}</Badge>
          {tool.requiresLocalDevice ? <Badge>Local device</Badge> : null}
          {tool.authoritativeBilling === false ? <Badge>Non-authoritative billing</Badge> : null}
          {(tool.riskTags ?? []).map((tag) => (
            <Badge key={tag}>{tag}</Badge>
          ))}
        </div>

        {noAgents ? (
          <p className="text-xs text-warning">No backing agent is registered for this tool.</p>
        ) : disabledAgents ? (
          <p className="text-xs text-warning">Every backing agent is disabled.</p>
        ) : null}

        {isCcusage ? (
          <CcusageForm tool={tool} disabled={!deviceOnline || noAgents || disabledAgents} />
        ) : isReview ? (
          <ReviewForm
            tool={tool}
            worktrees={worktrees}
            projects={projects}
            disabled={!deviceOnline || noAgents || disabledAgents}
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            This tool has no console invoke form yet. Select it to inspect its schema.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Shared success/error surface + "view invocation" jump for both forms. */
function useToolInvoke() {
  const setSelectedInvocationId = useUiStore((s) => s.setSelectedInvocationId);
  const setSection = useUiStore((s) => s.setSection);
  const { execute, pending, error } = useAsyncAction();
  const [invocationId, setInvocationId] = useState<string | null>(null);
  const [approvalRequestId, setApprovalRequestId] = useState<string | null>(null);

  async function invoke(name: string, input: ToolInvocationRequest) {
    setInvocationId(null);
    setApprovalRequestId(null);
    await execute(async () => {
      const result = await api.createToolInvocation(name, input);
      setInvocationId(result.invocationId);
      setApprovalRequestId(result.approvalRequestId ?? null);
      return result;
    });
  }

  function viewInvocation() {
    if (!invocationId) return;
    setSelectedInvocationId(invocationId);
    setSection("invocations");
  }

  return { invoke, viewInvocation, invocationId, approvalRequestId, pending, error };
}

function useApprovalAction() {
  const { execute, pending, error } = useAsyncAction();
  async function approve(approvalRequestId: string) {
    return execute(() => api.approveApproval(approvalRequestId));
  }
  return { approve, pending, error };
}

function useCodexProposalReviewAction() {
  const { execute, pending, error } = useAsyncAction();
  async function review(proposalId: string, action: "approve" | "reject") {
    return execute(() => api.reviewCodexPatchProposal(proposalId, { action }));
  }
  return { review, pending, error };
}

function ResultNote({
  invocationId,
  error,
  outputCollection,
  onView,
}: {
  invocationId: string | null;
  error: string | null;
  outputCollection?: string;
  onView: () => void;
}) {
  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!invocationId) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span className="text-success">Invocation created.</span>
      <span className="font-mono text-[11px] text-foreground">{invocationId}</span>
      {outputCollection ? <span>Results import into {outputCollection}.</span> : null}
      <button type="button" className="font-medium text-primary hover:underline" onClick={onView}>
        View invocation →
      </button>
    </div>
  );
}

/**
 * Sources the backend accepts for a report: a provider-specific source is only
 * valid for a matching provider report (source_report_mismatch otherwise).
 */
export function ccusageSourcesFor(report: string): Array<"all" | "codex" | "claude"> {
  const sources: Array<"all" | "codex" | "claude"> = ["all"];
  if (report.startsWith("codex_")) sources.push("codex");
  if (report.startsWith("claude_")) sources.push("claude");
  return sources;
}

function CcusageForm({ tool, disabled }: { tool: ToolDescriptor; disabled: boolean }) {
  const reportOptions = useMemo(() => {
    // Drop approval-required reports (e.g. session) — they always 409 here.
    const policy = tool.approvalPolicy ?? {};
    const fromAgents = (tool.agents ?? [])
      .map((agent) => agent.report)
      .filter((r): r is string => Boolean(r))
      .filter((r) => policy[r] !== "approval_required");
    return fromAgents.length ? Array.from(new Set(fromAgents)) : ["daily"];
  }, [tool.agents, tool.approvalPolicy]);

  const [report, setReport] = useState(reportOptions[0]);
  const [source, setSource] = useState<"all" | "codex" | "claude">("all");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const { invoke, viewInvocation, invocationId, pending, error } = useToolInvoke();

  // Keep the selection valid as discovered options load/change after mount.
  useEffect(() => {
    if (!reportOptions.includes(report)) setReport(reportOptions[0]);
  }, [reportOptions, report]);

  const sourceOptions = useMemo(() => ccusageSourcesFor(report), [report]);
  useEffect(() => {
    if (!sourceOptions.includes(source)) setSource("all");
  }, [sourceOptions, source]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    void invoke(tool.name, {
      report,
      source,
      since: since || null,
      until: until || null,
      offline: true,
    });
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Report">
          <Select value={report} onChange={(e) => setReport(e.target.value)}>
            {reportOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Source">
          <Select value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
            {sourceOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Since (YYYY-MM-DD)">
          <Input value={since} onChange={(e) => setSince(e.target.value)} placeholder="optional" />
        </Field>
        <Field label="Until (YYYY-MM-DD)">
          <Input value={until} onChange={(e) => setUntil(e.target.value)} placeholder="optional" />
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">
        Offline mode only — online and session reports require explicit approval.
      </p>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={disabled || pending}>
          {pending ? "Running…" : "Run report"}
        </Button>
        <ResultNote
          invocationId={invocationId}
          error={error}
          outputCollection={tool.outputCollection}
          onView={viewInvocation}
        />
      </div>
    </form>
  );
}

function ReviewForm({
  tool,
  worktrees,
  projects,
  disabled,
}: {
  tool: ToolDescriptor;
  worktrees: WorktreeSnapshot[];
  projects: ProjectSnapshot[];
  disabled: boolean;
}) {
  const projectName = useMemo(() => {
    const map = new Map(projects.map((project) => [project.id, project.name]));
    return (id: string) => map.get(id) ?? id;
  }, [projects]);

  const [worktreeId, setWorktreeId] = useState(worktrees[0]?.id ?? "");
  const [severityFloor, setSeverityFloor] = useState<"low" | "medium" | "high">("low");
  const [instruction, setInstruction] = useState("");
  const { invoke, viewInvocation, invocationId, pending, error } = useToolInvoke();

  // Worktrees arrive from a different query than the one that mounts this form;
  // re-sync the selection once they load (or if the chosen one disappears).
  useEffect(() => {
    if (!worktrees.some((worktree) => worktree.id === worktreeId)) {
      setWorktreeId(worktrees[0]?.id ?? "");
    }
  }, [worktrees, worktreeId]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const worktree = worktrees.find((item) => item.id === worktreeId);
    if (!worktree) return;
    // Send the worktree's own project so the backend doesn't reject it against
    // the actor's default project (worktree_not_found).
    void invoke(tool.name, {
      projectId: worktree.projectId,
      worktreeId,
      severityFloor,
      instruction: instruction.trim() || null,
    });
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Worktree">
          <Select value={worktreeId} onChange={(e) => setWorktreeId(e.target.value)}>
            {!worktrees.length ? <option value="">No worktrees available</option> : null}
            {worktrees.map((worktree) => (
              <option key={worktree.id} value={worktree.id}>
                {worktree.branch} · {projectName(worktree.projectId)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Severity floor">
          <Select
            value={severityFloor}
            onChange={(e) => setSeverityFloor(e.target.value as typeof severityFloor)}
          >
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </Select>
        </Field>
      </div>
      <Field label="Instruction (optional)">
        <Textarea
          value={instruction}
          maxLength={1200}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="Focus areas for the reviewer…"
        />
      </Field>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={disabled || pending || !worktreeId}>
          {pending ? "Starting…" : "Run review"}
        </Button>
        <ResultNote
          invocationId={invocationId}
          error={error}
          outputCollection={tool.outputCollection}
          onView={viewInvocation}
        />
      </div>
    </form>
  );
}
