import { worktreeAutoRunPrompt } from "@myagenttool/protocol/issue-prompt";

import { normalizeWorktreeLink } from "./projects.mjs";

// One-click "Auto" orchestrator (Phase 1). It closes the seam the console never
// had: turning a linked GitHub issue into a worktree AND a started agent run
// seeded with an issue-derived prompt. It does not open a PR — the agent run's
// completion, verification, and publish/PR are later slices. Merge stays human.
//
// Lifecycle: materializing -> running | awaiting_approval -> (later)
// verifying -> publishing -> pr_open -> done | failed. Kickoff sets the first
// terminal-of-this-slice status from the invocation the run started with; a
// high-risk agent lands in awaiting_approval because the invocation itself does
// (Auto never bypasses the local-approval gate).
export const autoRunStates = [
  "materializing",
  "running",
  "awaiting_approval",
  "verifying",
  "publishing",
  "pr_open",
  "done",
  "failed",
];

export function createAutoRunService({
  state,
  now,
  nextId,
  appendEvent,
  persistStateSoon,
  createWorktree,
  findAgent,
  defaultAgent,
  createInvocation,
  startInvocationIfAllowed,
}) {
  function autoRunStatusForInvocation(invocation) {
    if (invocation.status === "waiting_for_local_approval") return "awaiting_approval";
    if (invocation.status === "rejected") return "failed";
    return "running";
  }

  // Start an auto-run for a linked issue/PR: materialize the worktree, seed the
  // agent prompt from the issue, and start the invocation inside the worktree.
  // `name` is the branch name the caller already derives (shared branchFromIssue),
  // so the server does not re-implement issue branch naming.
  function startAutoRun({ projectId, link, agentId, name, baseBranch, actor } = {}) {
    const normalizedLink = normalizeWorktreeLink(link);
    if (!normalizedLink) {
      throw new Error("A GitHub issue or PR link is required to start an auto-run.");
    }
    const agent = agentId ? findAgent(agentId) : defaultAgent();
    if (!agent) {
      throw new Error("No agent is registered to run this issue.");
    }
    if (agent.status === "disabled") {
      throw new Error("The selected agent is disabled.");
    }
    if (agent.location?.type === "local_device" && state.device?.unlinkState !== "linked") {
      throw new Error("The target device is unlinked; link it before starting an auto-run.");
    }

    const autoRunId = nextId("aur_demo");
    const createdAt = now();

    // 1. Materialize the worktree from the issue.
    const { worktree } = createWorktree({
      projectId,
      name: name || `issue-${normalizedLink.number}`,
      baseBranch,
      agentId: agent.id,
      link: normalizedLink,
    });

    // 2. Seed the prompt from the issue, and 3. start the agent run in the worktree.
    const task = worktreeAutoRunPrompt(normalizedLink);
    const invocation = createInvocation(task, agent, {
      actor,
      metadata: { worktreeId: worktree.id, projectId: worktree.projectId, autoRunId },
    });
    startInvocationIfAllowed(invocation, agent);

    const autoRun = {
      id: autoRunId,
      status: autoRunStatusForInvocation(invocation),
      projectId: worktree.sourceProjectId ?? worktree.projectId ?? projectId ?? null,
      worktreeId: worktree.id,
      invocationId: invocation.id,
      agentId: agent.id,
      link: normalizedLink,
      branchName: worktree.branchName ?? worktree.branch ?? null,
      requestedBy: actor?.userId ?? "usr_local",
      createdAt,
      updatedAt: createdAt,
    };
    state.autoRuns.unshift(autoRun);
    appendEvent({
      invocationId: invocation.id,
      type: "auto_run_started",
      level: "info",
      message: `Auto-run started for ${normalizedLink.type} #${normalizedLink.number}.`,
      data: { autoRunId, worktreeId: worktree.id, invocationId: invocation.id, status: autoRun.status },
    });
    persistStateSoon();
    return { autoRun, worktree, invocation };
  }

  return { startAutoRun };
}
