export function createInvocationCompareRuntime({
  state,
  now,
  nextId,
  createInvocation,
  startInvocationIfAllowed,
  updateCompareRun,
  createWorktree,
  createWorktreePr,
  latestWorktreeReview,
  findInvocation,
}) {
  function createCompareRun(task, agents, options = {}) {
    const createdAt = now();
    const { projectId: rawProjectId, ...restOptions } = options ?? {};
    const projectId = rawProjectId ?? restOptions.metadata?.projectId ?? null;
    // Per-agent worktree ISOLATION (P4.2): when a project is given, each agent runs
    // in its OWN worktree so code-editing agents don't collide + their diffs can be
    // compared. Without a project it stays shared context (read-only/answer compares).
    const isolate = Boolean(projectId) && typeof createWorktree === "function";
    const compareRun = {
      id: nextId("cmp_demo"),
      task,
      requestedBy: options.actor?.userId ?? "usr_local",
      projectId: projectId ?? null,
      isolated: isolate,
      status: "running",
      childInvocationIds: [],
      children: [], // { invocationId, agentId, worktreeId }
      preferredInvocationId: null,
      promotion: null,
      summary: "Compare run started.",
      createdAt,
      updatedAt: createdAt
    };
    state.compareRuns.unshift(compareRun);
    const baseMeta = restOptions.metadata && typeof restOptions.metadata === "object" && !Array.isArray(restOptions.metadata) ? restOptions.metadata : {};
    for (const agent of agents) {
      let worktreeId = null;
      if (isolate) {
        try {
          worktreeId = createWorktree({ projectId, name: `cmp-${compareRun.id.slice(-6)}-${agent.id}`, agentId: agent.id })?.worktree?.id ?? null;
        } catch {
          worktreeId = null; // best-effort: fall back to shared context for this agent
        }
      }
      const invocation = createInvocation(task, agent, {
        ...restOptions,
        metadata: {
          ...baseMeta,
          compareRunId: compareRun.id,
          ...(worktreeId ? { worktreeId, projectId } : {})
        }
      });
      invocation.compareRunId = compareRun.id;
      compareRun.childInvocationIds.push(invocation.id);
      compareRun.children.push({ invocationId: invocation.id, agentId: agent.id, worktreeId });
      startInvocationIfAllowed(invocation, agent);
    }
    updateCompareRun(compareRun);
    return compareRun;
  }

  // P4.2c: a human picks the winner (overrides the auto-picked first-success).
  function setCompareRunPreferred(compareRunId, invocationId, { actor } = {}) {
    const compareRun = state.compareRuns.find((c) => c.id === compareRunId);
    if (!compareRun) throw new Error("Compare run not found.");
    if (!compareRun.childInvocationIds.includes(invocationId)) {
      throw new Error("That invocation is not part of this compare run.");
    }
    compareRun.preferredInvocationId = invocationId;
    compareRun.preferredBy = actor?.userId ?? "usr_local";
    compareRun.updatedAt = now();
    return compareRun;
  }

  // P4.2c: promote the preferred agent's worktree — open its PR (reuse the worktree
  // publish/PR path). Only meaningful for an isolated (code-editing) compare; a
  // shared/answer compare has no worktree to promote.
  async function promoteCompareRun(compareRunId, { actor } = {}) {
    const compareRun = state.compareRuns.find((c) => c.id === compareRunId);
    if (!compareRun) throw new Error("Compare run not found.");
    const invocationId = compareRun.preferredInvocationId;
    if (!invocationId) throw new Error("Set a preferred agent before promoting.");
    if (compareRun.promotion?.prNumber) {
      return compareRun; // idempotent: already promoted
    }
    const child = compareRun.children?.find((c) => c.invocationId === invocationId) ?? null;
    const worktreeId = child?.worktreeId ?? (typeof findInvocation === "function" ? findInvocation(invocationId)?.worktreeId : null);
    if (!worktreeId) throw new Error("The preferred run has no worktree to promote (a shared/answer compare cannot be promoted).");
    // Phase 5: review-before-ship. A human must approve the preferred worktree's
    // diff before it can be promoted to a PR. `changes_requested` or no review yet
    // both block; the reviewer just submits an approval to unblock.
    if (typeof latestWorktreeReview === "function") {
      const review = latestWorktreeReview(worktreeId);
      if (review?.verdict !== "approved") {
        throw new Error(
          review?.verdict === "changes_requested"
            ? "The preferred worktree has changes requested — resolve them and re-approve before promoting."
            : "The preferred worktree has not been reviewed yet — approve its diff before promoting.",
        );
      }
    }
    if (typeof createWorktreePr !== "function") throw new Error("Pull-request creation is not available on this server.");
    const pr = await createWorktreePr(worktreeId, { body: `Promoted from compare run ${compareRun.id}.\n\nTask: ${compareRun.task}` });
    compareRun.promotion = {
      invocationId,
      worktreeId,
      prNumber: pr?.number ?? null,
      prUrl: pr?.url ?? null,
      by: actor?.userId ?? "usr_local",
      at: now(),
    };
    compareRun.status = "promoted";
    compareRun.updatedAt = now();
    return compareRun;
  }

  return {
    createCompareRun,
    setCompareRunPreferred,
    promoteCompareRun,
  };
}
