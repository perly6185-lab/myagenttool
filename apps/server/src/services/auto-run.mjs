import { roleAutoRunPrompt } from "@myagenttool/protocol/issue-prompt";

import { normalizeWorktreeLink } from "./projects.mjs";
import { intentForPath, resolveDecision } from "./auto-run-decision.mjs";
import { isSpawnedChildBody } from "./auto-run-spawn.mjs";

// One-click "Auto" orchestrator. It closes the seam the console never had:
// turning a linked GitHub issue into a worktree AND a started agent run seeded
// with an issue-derived prompt, then — on the run completing — verifying and
// opening a PR. Merge stays human.
//
// Lifecycle: materializing -> running | awaiting_approval -> verifying ->
// publishing -> pr_open | blocked | failed. Kickoff (startAutoRun) sets the
// first status from the invocation it started; a high-risk agent lands in
// awaiting_approval because the invocation itself does (Auto never bypasses the
// local-approval gate). The reaction (advanceAutoRunForInvocation) runs the
// verification gate and opens the PR — a failed real check blocks it.
export const autoRunStates = [
  "materializing",
  "running",
  "awaiting_approval",
  "verifying",
  "publishing",
  "pr_open",
  "report_posted",
  "needs_input",
  "blocked",
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
  commitWorktreeChanges,
  publishWorktreeBranch,
  createWorktreePr,
  verifyWorktree,
  writeIssueStatus,
  decideIssuePath,
  fetchIssueBody,
  postIssueReport,
  spawnChildIssue,
}) {
  // Best-effort issue body fetch (issue links only): richer context for both the
  // decision and the role prompt. Null on any failure — the run proceeds on the
  // title alone rather than failing on a gh hiccup.
  async function maybeFetchIssueBody(link, projectId) {
    if (typeof fetchIssueBody !== "function") return null;
    if (link?.type !== "issue" || !Number.isFinite(link?.number)) return null;
    const project = state.projects.find((item) => item.id === projectId) ?? null;
    if (!project?.path) return null;
    try {
      const body = await fetchIssueBody({ issueNumber: link.number, repoPath: project.path });
      return typeof body === "string" && body.trim() ? body : null;
    } catch {
      return null;
    }
  }

  // The agent's summary from the completed invocation — the deliverable for an
  // investigation (there is no diff to ship).
  function extractRunSummary(invocation) {
    const result = invocation?.result;
    if (!result) return null;
    if (typeof result === "string") return result.slice(0, 4000);
    if (typeof result.summary === "string") return result.summary.slice(0, 4000);
    if (typeof result.text === "string") return result.text.slice(0, 4000);
    try {
      return JSON.stringify(result).slice(0, 2000);
    } catch {
      return null;
    }
  }

  // Governed child-issue spawning (slice 4): a design/prototype deliverable
  // becomes a pending-decision child issue. Guards: opt-in (composer wires
  // spawnChildIssue only when enabled), issue links only, depth-1 (a spawned
  // child never spawns grandchildren), and one child per parent issue (dedup
  // across all runs). Best-effort: a spawn failure never breaks the run.
  async function maybeSpawnChildIssue(autoRun, worktree, design) {
    if (typeof spawnChildIssue !== "function") return null;
    if (autoRun.link?.type !== "issue" || !Number.isFinite(autoRun.link?.number)) return null;
    if (autoRun.isChildIssue) return null;
    const repoPath = worktree?.repoPath ?? null;
    if (!repoPath) return null;
    const alreadySpawned = state.autoRuns.some(
      (run) => run.link?.number === autoRun.link.number && Array.isArray(run.childIssues) && run.childIssues.length > 0,
    );
    if (alreadySpawned) return null;
    try {
      const child = await spawnChildIssue({ parentLink: autoRun.link, design, repoPath });
      if (!child || !Number.isFinite(child.number)) return null;
      appendEvent({
        invocationId: autoRun.invocationId,
        type: "auto_run_child_spawned",
        level: "info",
        message: `Auto-run ${autoRun.id} spawned pending-decision child issue #${child.number}.`,
        data: { autoRunId: autoRun.id, parentIssue: autoRun.link.number, childIssue: child.number, url: child.url ?? null },
      });
      return { child: { number: child.number, url: child.url ?? null } };
    } catch (error) {
      return { error: `Child issue spawn failed: ${String(error?.message ?? error)}` };
    }
  }

  // Best-effort: post the investigation summary back to the issue (opt-in, gated
  // by the same GitHub-write config as status writeback). Fire-and-forget.
  function maybePostIssueReport(autoRun, worktree, body) {
    if (typeof postIssueReport !== "function") return;
    if (autoRun.link?.type !== "issue" || !Number.isFinite(autoRun.link?.number)) return;
    const repoPath = worktree?.repoPath ?? null;
    if (!repoPath || !body) return;
    Promise.resolve(postIssueReport({ issueNumber: autoRun.link.number, repoPath, body })).catch(() => {});
  }
  function commitMessageFor(autoRun) {
    const link = autoRun.link;
    if (link?.type === "issue" && Number.isFinite(link.number)) {
      return `Auto-run: ${link.title ?? "changes"} (#${link.number})`;
    }
    return "Auto-run changes";
  }
  // Best-effort issue status writeback (Phase 4). Only for issue-linked runs;
  // fire-and-forget so a slow/failed gh never blocks the orchestrator.
  function maybeWriteIssueStatus(autoRun, worktree, to) {
    if (typeof writeIssueStatus !== "function") return;
    if (autoRun.link?.type !== "issue" || !Number.isFinite(autoRun.link?.number)) return;
    const repoPath = worktree?.repoPath ?? null;
    if (!repoPath) return;
    Promise.resolve(writeIssueStatus({ issueNumber: autoRun.link.number, repoPath, to })).catch(() => {});
  }
  // Reaction states already handled — advancing past them would re-open a PR.
  // `blocked` (verification failed) is terminal here; a human retries/fixes.
  const settledStatuses = new Set(["pr_open", "report_posted", "needs_input", "blocked", "done", "failed"]);

  // The PR body an auto-run opens with, carrying the verification evidence so the
  // pull request is honest about whether checks ran and passed.
  function verificationEvidenceBody(verification) {
    const state = verification.verified ? (verification.passed ? "passed" : "failed") : "not run (no verification command configured)";
    return `Automated auto-run pull request.\n\n## Verification\n- Checks: ${state}\n${verification.summary ? `\n${verification.summary}\n` : ""}`;
  }

  function autoRunStatusForInvocation(invocation) {
    if (invocation.status === "waiting_for_local_approval") return "awaiting_approval";
    if (invocation.status === "rejected") return "failed";
    return "running";
  }

  function setAutoRunStatus(autoRun, status, extra) {
    autoRun.status = status;
    autoRun.updatedAt = now();
    if (extra) Object.assign(autoRun, extra);
    appendEvent({
      invocationId: autoRun.invocationId,
      type: "auto_run_status_changed",
      level: status === "failed" ? "warn" : "info",
      message: `Auto-run ${autoRun.id} → ${status}.`,
      data: { autoRunId: autoRun.id, status, worktreeId: autoRun.worktreeId },
    });
  }

  // Start an auto-run for a linked issue/PR: materialize the worktree, seed the
  // agent prompt from the issue, and start the invocation inside the worktree.
  // `name` is the branch name the caller already derives (shared branchFromIssue),
  // so the server does not re-implement issue branch naming.
  async function startAutoRun({ projectId, link, agentId, name, baseBranch, actor } = {}) {
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

    // 0. Decision step: the injected decider (or the heuristic floor) triages the
    // issue into a path BEFORE any execution. The decision is data, not action.
    // Both the decider and the role prompt get the issue body when it's readable.
    const issueBody = await maybeFetchIssueBody(normalizedLink, projectId ?? state.currentProjectId);
    const decision = await resolveDecision({ link: normalizedLink, issueBody, decideIssuePath });

    // 1. Materialize the worktree from the issue.
    const { worktree } = createWorktree({
      projectId,
      name: name || `issue-${normalizedLink.number}`,
      baseBranch,
      agentId: agent.id,
      link: normalizedLink,
    });

    // Record the auto-run BEFORE starting the invocation so the dedup key exists
    // even if invocation creation throws — otherwise auto-trigger, which dedups on
    // autoRuns, would re-pick this issue every tick and pile up orphan worktrees.
    const autoRun = {
      id: autoRunId,
      status: "materializing",
      projectId: worktree.sourceProjectId ?? worktree.projectId ?? projectId ?? null,
      worktreeId: worktree.id,
      invocationId: null,
      agentId: agent.id,
      link: normalizedLink,
      decision,
      // Legacy field, derived from the decision path for record continuity.
      intent: intentForPath(decision.path),
      // Depth-1 guard: a spawned child issue may never spawn grandchildren.
      isChildIssue: isSpawnedChildBody(issueBody),
      branchName: worktree.branchName ?? worktree.branch ?? null,
      requestedBy: actor?.userId ?? "usr_local",
      createdAt,
      updatedAt: createdAt,
    };
    state.autoRuns.unshift(autoRun);
    // The routing decision is auditable evidence: path, who decided, and why.
    appendEvent({
      invocationId: null,
      type: "auto_run_decided",
      level: "info",
      message: `Auto-run ${autoRunId} routed to "${decision.path}" by ${decision.decidedBy}.`,
      data: {
        autoRunId,
        path: decision.path,
        decidedBy: decision.decidedBy,
        confidence: decision.confidence,
        spawnChildIssues: decision.spawnChildIssues,
        rationale: decision.rationale,
      },
    });

    // 2. Seed the prompt from the issue, and 3. start the agent run in the worktree.
    let invocation;
    try {
      const task = roleAutoRunPrompt(normalizedLink, { path: decision.path, issueBody });
      invocation = createInvocation(task, agent, {
        actor,
        metadata: { worktreeId: worktree.id, projectId: worktree.projectId, autoRunId },
      });
      startInvocationIfAllowed(invocation, agent);
    } catch (error) {
      setAutoRunStatus(autoRun, "failed", { error: `Could not start the agent run: ${String(error?.message ?? error)}` });
      persistStateSoon();
      throw error;
    }

    autoRun.invocationId = invocation.id;
    setAutoRunStatus(autoRun, autoRunStatusForInvocation(invocation));
    appendEvent({
      invocationId: invocation.id,
      type: "auto_run_started",
      level: "info",
      message: `Auto-run started for ${normalizedLink.type} #${normalizedLink.number}.`,
      data: { autoRunId, worktreeId: worktree.id, invocationId: invocation.id, status: autoRun.status },
    });
    // The run has begun (or is parked for approval) — mark the issue in-progress.
    if (autoRun.status !== "failed") {
      maybeWriteIssueStatus(autoRun, worktree, "in-progress");
    }
    persistStateSoon();
    return { autoRun, worktree, invocation };
  }

  // Reaction: when an auto-run's invocation reaches a terminal state, advance the
  // state machine. On success, publish the branch and open the PR (Phase 2 will
  // front-run a verification gate here). On failure, mark the auto-run failed.
  // Called fire-and-forget from completion, so it never throws.
  async function advanceAutoRunForInvocation(invocation) {
    try {
      const autoRun = state.autoRuns.find((item) => item.invocationId === invocation?.id);
      if (!autoRun || settledStatuses.has(autoRun.status)) return null;

      if (invocation.status === "succeeded") {
        const worktree = state.worktrees.find((item) => item.id === autoRun.worktreeId) ?? null;

        // Commit the agent's edits so they actually reach the PR (publish only
        // ships commits), and stop early if the run produced nothing to open a PR
        // with — otherwise gh pr create would fail with a confusing error.
        if (typeof commitWorktreeChanges === "function") {
          let commitResult;
          try {
            commitResult = await commitWorktreeChanges(autoRun.worktreeId, { message: commitMessageFor(autoRun) });
          } catch (error) {
            setAutoRunStatus(autoRun, "failed", { error: `Commit failed: ${String(error?.message ?? error)}` });
            persistStateSoon();
            return autoRun;
          }
          if (!commitResult.hasCommits) {
            // No diff — route by the decided path instead of treating it as a
            // dead end. A design/prototype run's deliverable IS the findings; a
            // clarify run hands its questions back to a human; only a develop
            // run with no diff is blocked. Old persisted records without a
            // decision fall back to the legacy intent mapping.
            const path = autoRun.decision?.path
              ?? ({ investigation: "design", question: "clarify" }[autoRun.intent] ?? "develop");
            if (path === "design" || path === "prototype") {
              const summary = extractRunSummary(invocation) ?? "Investigation complete — no code change was needed.";
              maybePostIssueReport(autoRun, worktree, summary);
              const spawn = await maybeSpawnChildIssue(autoRun, worktree, summary);
              setAutoRunStatus(autoRun, "report_posted", {
                report: summary,
                error: null,
                ...(spawn?.child ? { childIssues: [spawn.child] } : {}),
                ...(spawn?.error ? { spawnError: spawn.error } : {}),
              });
              // The design is delivered and waits on a human — the issue label
              // should say review, not linger at in-progress. (Pilot finding.)
              maybeWriteIssueStatus(autoRun, worktree, "review");
            } else if (path === "clarify") {
              const questions = autoRun.decision?.clarifyingQuestions ?? [];
              const summary = extractRunSummary(invocation);
              const report = questions.length
                ? `${summary ? `${summary}\n\n` : ""}Open questions:\n${questions.map((q) => `- ${q}`).join("\n")}`
                : summary;
              setAutoRunStatus(autoRun, "needs_input", {
                report,
                error: "The run needs a human decision before it can proceed.",
              });
              maybeWriteIssueStatus(autoRun, worktree, "review");
            } else {
              setAutoRunStatus(autoRun, "blocked", { error: "The agent run produced no changes to open a pull request with." });
            }
            persistStateSoon();
            return autoRun;
          }
        }

        // Verification gate: run the project's checks in the worktree. A real
        // check that fails BLOCKS the PR; an unconfigured gate opens the PR but
        // labels it unverified (never fabricates a pass).
        setAutoRunStatus(autoRun, "verifying");
        let verification = { passed: true, verified: false, summary: "No verification command configured." };
        try {
          if (typeof verifyWorktree === "function") {
            verification = await verifyWorktree({ worktree, autoRun });
          }
        } catch (error) {
          verification = { passed: false, verified: true, summary: `Verification error: ${String(error?.message ?? error)}` };
        }
        autoRun.verification = { passed: verification.passed, verified: verification.verified, summary: verification.summary ?? null };
        if (verification.verified && !verification.passed) {
          setAutoRunStatus(autoRun, "blocked", { error: verification.summary ?? "Verification failed." });
          persistStateSoon();
          return autoRun;
        }
        setAutoRunStatus(autoRun, "publishing");
        try {
          await publishWorktreeBranch(autoRun.worktreeId);
          const pr = await createWorktreePr(autoRun.worktreeId, { body: verificationEvidenceBody(verification) });
          setAutoRunStatus(autoRun, "pr_open", { prNumber: pr?.number ?? null, prUrl: pr?.url ?? null, error: null });
          maybeWriteIssueStatus(autoRun, worktree, "review");
        } catch (error) {
          setAutoRunStatus(autoRun, "failed", { error: String(error?.message ?? error) });
        }
      } else {
        // failed | timed_out | cancelled | rejected
        setAutoRunStatus(autoRun, "failed", { error: `Agent run ${invocation.status}.` });
      }
      persistStateSoon();
      return autoRun;
    } catch {
      // Never let a reaction error escape the fire-and-forget caller.
      return null;
    }
  }

  // Reflect a granted approval on the run card: without this the auto-run sat
  // at awaiting_approval until a terminal state. (Pilot finding.)
  function syncAutoRunOnApproval(invocation) {
    const autoRun = state.autoRuns.find((item) => item.invocationId === invocation?.id);
    if (!autoRun || autoRun.status !== "awaiting_approval") return null;
    setAutoRunStatus(autoRun, "running");
    persistStateSoon();
    return autoRun;
  }

  // Retry a failed/blocked auto-run on its existing worktree: rebuild the role
  // prompt and start a fresh invocation for the same record. Without this a
  // failed run dead-ended — the trigger dedup (correctly) never re-picks an
  // issue that has a settled run. (Pilot finding.)
  async function retryAutoRun(autoRunId, { actor } = {}) {
    const autoRun = state.autoRuns.find((item) => item.id === autoRunId);
    if (!autoRun) throw new Error("Auto-run not found.");
    if (!["failed", "blocked"].includes(autoRun.status)) {
      throw new Error("Only a failed or blocked auto-run can be retried.");
    }
    const worktree = state.worktrees.find((item) => item.id === autoRun.worktreeId) ?? null;
    if (!worktree) throw new Error("The auto-run's worktree no longer exists; start a fresh run instead.");
    const agent = (autoRun.agentId ? findAgent(autoRun.agentId) : null) ?? defaultAgent();
    if (!agent) throw new Error("No agent is registered to retry this run.");
    if (agent.status === "disabled") throw new Error("The selected agent is disabled.");
    if (agent.location?.type === "local_device" && state.device?.unlinkState !== "linked") {
      throw new Error("The target device is unlinked; link it before retrying.");
    }

    const issueBody = await maybeFetchIssueBody(autoRun.link, autoRun.projectId);
    const task = roleAutoRunPrompt(autoRun.link, { path: autoRun.decision?.path ?? "develop", issueBody });
    let invocation;
    try {
      invocation = createInvocation(task, agent, {
        actor,
        metadata: { worktreeId: worktree.id, projectId: worktree.projectId, autoRunId: autoRun.id },
      });
      startInvocationIfAllowed(invocation, agent);
    } catch (error) {
      setAutoRunStatus(autoRun, "failed", { error: `Retry could not start the agent run: ${String(error?.message ?? error)}` });
      persistStateSoon();
      throw error;
    }
    autoRun.invocationId = invocation.id;
    setAutoRunStatus(autoRun, autoRunStatusForInvocation(invocation), { error: null, prNumber: null, prUrl: null });
    appendEvent({
      invocationId: invocation.id,
      type: "auto_run_retried",
      level: "info",
      message: `Auto-run ${autoRun.id} retried on its existing worktree.`,
      data: { autoRunId: autoRun.id, worktreeId: worktree.id, invocationId: invocation.id, status: autoRun.status },
    });
    persistStateSoon();
    return { autoRun, invocation };
  }

  return { startAutoRun, advanceAutoRunForInvocation, syncAutoRunOnApproval, retryAutoRun };
}
